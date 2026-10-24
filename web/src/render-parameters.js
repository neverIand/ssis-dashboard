import { createDisplay, formatBoolean, formatCode, formatId } from './display.js';

export function mountParameters(root, { metadata, actions, restoreView = null }) {
  const document = root.ownerDocument, enabled = metadata.capabilities.values;
  const get = name => root.querySelector(`[data-parameters-${name}]`);
  const controls = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'limit', 'scroll'].map(key => [key, get(key)]));
  const { toggle, retry, previous, next, latest, limit, scroll } = controls;
  const panel = get('panel'), status = get('status'), notice = get('notice'), table = get('table');
  const body = table.querySelector('tbody'), rows = new Map(), listeners = [];
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const initialFocus = document.activeElement, initialScroll = { left: scroll.scrollLeft, top: scroll.scrollTop };
  let returning = enabled ? restoreView : null, current = null, rendered = null, busy = true;
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const flags = [['sensitive', 'Sensitive'], ['required', 'Required'], ['value_set', 'Value set'], ['runtime_override', 'Runtime override']];
  limit.max = String(metadata.limits.max_limit);
  function empty(message) {
    rows.clear(); const row = element('tr'), cell = element('td', message, 'empty-state');
    cell.colSpan = 5; row.append(cell); body.replaceChildren(row);
  }
  function paint(page, pageNumber) {
    if (!page.data.length) { empty(pageNumber > 1 ? 'No parameters remain on this page. Use Previous or Show latest.' : 'No parameters on this page.'); return; }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set(); let anchor = body.firstChild;
    for (const item of page.data) {
      const id = item.execution_parameter_id; wanted.add(id);
      let row = rows.get(id);
      if (!row) {
        const node = element('tr'); node.dataset.parameterId = id;
        const cells = Array.from({ length: 5 }, () => element('td'));
        cells[0].className = 'parameter-name'; cells[2].className = 'parameter-type';
        const name = element('span'), identity = element('span', undefined, 'cell-detail'); cells[0].append(name, identity);
        const preview = element('p', undefined, 'parameter-preview'), truncated = element('p', undefined, 'cell-detail');
        const value = element('details'), valueSummary = element('summary', 'View value'), full = element('p', undefined, 'parameter-value');
        value.append(valueSummary, full); cells[3].append(preview, truncated, value);
        const details = element('details'), summary = element('summary', 'View flags'), list = element('dl', undefined, 'parameter-flags');
        const values = {};
        for (const [key, label] of flags) { values[key] = element('dd'); list.append(element('dt', label), values[key]); }
        details.append(summary, list); cells[4].append(details); node.append(...cells);
        row = { node, cells, name, identity, preview, truncated, value, valueSummary, full, details, summary, values }; rows.set(id, row);
      }
      text(row.name, item.name); text(row.identity, `ID: ${formatId(id)}`);
      text(row.cells[1], formatCode(item.object_type)); text(row.cells[2], item.sql_type === '' ? '(empty)' : item.sql_type);
      const value = item.redacted ? `Redacted (${item.redaction_reason})` : item.value === null ? 'NULL (unredacted)' : item.value === '' ? '(empty)' : item.value;
      const characters = [...value]; text(row.preview, characters.length > 160 ? characters.slice(0, 160).join('') + '…' : value);
      // Clear old text when the same parameter becomes redacted; hidden content is not a redaction boundary.
      text(row.full, item.redacted ? '' : item.value ?? '');
      row.value.hidden = item.redacted || item.value === null || (characters.length <= 160 && !item.truncated);
      if (row.value.hidden) row.value.open = false;
      row.truncated.hidden = !item.truncated;
      text(row.truncated, item.truncated ? `Truncated to ${metadata.limits.max_text_characters} characters.` : '');
      for (const [key] of flags) text(row.values[key], formatBoolean(item[key]));
      if (row.node !== anchor) body.insertBefore(row.node, anchor);
      anchor = row.node.nextSibling;
    }
    for (const [id, row] of rows) if (!wanted.has(id)) { row.node.remove(); rows.delete(id); }
  }
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push([node, event, handler]); };
  listen(toggle, 'click', actions.toggle); listen(retry, 'click', actions.retry);
  listen(previous, 'click', actions.previous); listen(next, 'click', actions.next); listen(latest, 'click', actions.latest);
  listen(limit, 'change', () => {
    if (busy || !current) { if (current) limit.value = String(current.query.limit); return; }
    const value = Number(limit.value);
    if (Number.isSafeInteger(value) && value >= 1 && value <= metadata.limits.max_limit) actions.order({ limit: value });
    else notice.textContent = `Rows per page must be between 1 and ${metadata.limits.max_limit}.`;
  });
  return {
    render(state, isBusy, authorized) {
      current = state; busy = isBusy;
      const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
      const position = { left: scroll.scrollLeft, top: scroll.scrollTop }, permitted = enabled && authorized;
      if (!state.open) returning = null;
      get('unavailable').hidden = enabled;
      toggle.disabled = !permitted; toggle.textContent = state.open ? 'Hide parameters' : 'Show parameters';
      toggle.setAttribute('aria-expanded', String(state.open && permitted)); panel.hidden = !state.open || !permitted;
      for (const node of [retry, previous, next, latest, limit]) node.disabled = panel.hidden;
      for (const node of [retry, latest, limit]) node.setAttribute('aria-disabled', String(busy));
      previous.setAttribute('aria-disabled', String(busy || !state.hasPrevious)); next.setAttribute('aria-disabled', String(busy || !state.hasNext));
      table.setAttribute('aria-busy', String(busy)); retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      if (document.activeElement !== limit) limit.value = String(state.query.limit);
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      if (page !== rendered || page === null) {
        if (page) paint(page, state.pageNumber); else empty(state.phase === 'loading' ? 'Loading parameters…' : 'No parameters loaded.');
        rendered = page;
      }
      const info = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} parameters · Observed ${display.timestamp(page.meta.generated_at)} · Live results` : '';
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ' Previous parameter page shown. ' : ' '}${info}`
        : state.stale ? `Refreshing… Previous parameter page shown. ${info}` : state.phase === 'loading' ? 'Loading parameters…' : info;
      if (panel.hidden && panelFocused && permitted) toggle.focus({ preventScroll: true });
      else if (focused === retry && retry.hidden) toggle.focus({ preventScroll: true });
      else if (rowFocused && permitted) {
        let hidden = !focused.isConnected; for (let node = focused; node && node !== body; node = node.parentElement) hidden ||= node.hidden;
        if (hidden || document.activeElement !== focused) (hidden ? scroll : focused).focus({ preventScroll: true });
      }
      scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
      if (returning && page && !busy) {
        for (const id of returning.values ?? []) if (rows.has(id) && !rows.get(id).value.hidden) rows.get(id).value.open = true;
        for (const id of returning.flags ?? []) if (rows.has(id)) rows.get(id).details.open = true;
        if (document.activeElement === initialFocus) {
          const row = rows.get(returning.valueFocus);
          ((!row?.value.hidden && row?.valueSummary) || rows.get(returning.flagFocus)?.summary || controls[returning.focus]
            || ((returning.valueFocus || returning.flagFocus) ? scroll : null))?.focus({ preventScroll: true });
        }
        if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) {
          scroll.scrollLeft = returning.left; scroll.scrollTop = returning.top;
        }
        returning = null;
      }
    },
    checkpoint() {
      return { left: scroll.scrollLeft, top: scroll.scrollTop,
        values: [...rows].filter(([, row]) => row.value.open).map(([id]) => id), flags: [...rows].filter(([, row]) => row.details.open).map(([id]) => id),
        valueFocus: [...rows].find(([, row]) => row.valueSummary === document.activeElement)?.[0] ?? null,
        flagFocus: [...rows].find(([, row]) => row.summary === document.activeElement)?.[0] ?? null,
        focus: Object.keys(controls).find(key => controls[key] === document.activeElement) ?? null };
    },
    dispose() {
      for (const [node, event, handler] of listeners) node.removeEventListener(event, handler);
      rows.clear(); body.replaceChildren(); status.textContent = notice.textContent = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true; toggle.setAttribute('aria-expanded', 'false');
      current = returning = rendered = null;
    },
  };
}
