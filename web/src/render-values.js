import { createDisplay, formatBoolean, formatCode, formatId } from './display.js';

function mountValueTable(root, { metadata, actions, restoreView = null }, resource) {
  const parameter = resource === 'parameters', identity = parameter ? 'execution_parameter_id' : 'property_id';
  const valueColumn = parameter ? 3 : 1, extraKey = parameter ? 'flags' : 'paths', extraFocus = parameter ? 'flagFocus' : 'pathFocus';
  const document = root.ownerDocument, enabled = metadata.capabilities.values;
  const get = name => root.querySelector(`[data-${resource}-${name}]`);
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
    cell.colSpan = parameter ? 5 : 3; row.append(cell); body.replaceChildren(row);
  }
  function paint(page, pageNumber) {
    if (!page.data.length) { empty(pageNumber > 1 ? `No ${resource} remain on this page. Use Previous or Show latest.` : `No ${resource} on this page.`); return; }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set(); let anchor = body.firstChild;
    for (const item of page.data) {
      const id = item[identity]; wanted.add(id);
      let row = rows.get(id);
      if (!row) {
        const node = element('tr'); node.dataset[parameter ? 'parameterId' : 'propertyId'] = id;
        const cells = Array.from({ length: parameter ? 5 : 3 }, () => element('td'));
        cells[0].className = parameter ? 'parameter-name' : 'override-property';
        if (parameter) cells[2].className = 'parameter-type';
        const name = element('span'), identityLabel = element('span', undefined, 'cell-detail'); cells[0].append(name, identityLabel);
        const preview = element('p', undefined, 'value-preview'), truncated = element('p', undefined, 'cell-detail');
        const value = element('details'), valueSummary = element('summary', 'View value'), full = element('p', undefined, 'value-body');
        value.append(valueSummary, full); cells[valueColumn].append(preview, truncated, value);
        const details = element('details'), summary = element('summary', parameter ? 'View flags' : 'View path');
        const values = {}, fullPath = parameter ? null : element('p', undefined, 'override-path');
        details.append(summary);
        if (parameter) {
          const list = element('dl', undefined, 'parameter-flags');
          for (const [key, label] of flags) { values[key] = element('dd'); list.append(element('dt', label), values[key]); }
          details.append(list); cells[4].append(details);
        } else { details.append(fullPath); cells[0].append(details); }
        node.append(...cells);
        row = { node, cells, name, identity: identityLabel, preview, truncated, value, valueSummary, full, details, summary, values, fullPath }; rows.set(id, row);
      }
      text(row.identity, `ID: ${formatId(id)}`);
      if (parameter) {
        text(row.name, item.name); text(row.cells[1], formatCode(item.object_type));
        text(row.cells[2], item.sql_type === '' ? '(empty)' : item.sql_type);
        for (const [key] of flags) text(row.values[key], formatBoolean(item[key]));
      } else {
        const path = [...item.property_path];
        text(row.name, path.length > 160 ? path.slice(0, 160).join('') + '…' : item.property_path);
        text(row.fullPath, item.property_path); text(row.cells[2], formatBoolean(item.sensitive));
      }
      const value = item.redacted ? `Redacted (${item.redaction_reason})` : item.value === null ? 'NULL (unredacted)' : item.value === '' ? '(empty)' : item.value;
      const characters = [...value]; text(row.preview, characters.length > 160 ? characters.slice(0, 160).join('') + '…' : value);
      // Clear old text when a value becomes redacted; hidden content is not a redaction boundary.
      text(row.full, item.redacted ? '' : item.value ?? '');
      row.value.hidden = item.redacted || item.value === null || (characters.length <= 160 && !item.truncated);
      if (row.value.hidden) row.value.open = false;
      row.truncated.hidden = !item.truncated;
      text(row.truncated, item.truncated ? `Truncated to ${metadata.limits.max_text_characters} characters.` : '');
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
      if (!parameter) get('policy').hidden = !enabled || metadata.capabilities.override_values;
      panel.hidden = !state.open || !permitted;
      for (const node of [retry, previous, next, latest, limit]) node.disabled = panel.hidden;
      for (const node of [retry, latest, limit]) node.setAttribute('aria-disabled', String(busy));
      previous.setAttribute('aria-disabled', String(busy || !state.hasPrevious)); next.setAttribute('aria-disabled', String(busy || !state.hasNext));
      table.setAttribute('aria-busy', String(busy)); retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      if (document.activeElement !== limit) limit.value = String(state.query.limit);
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      if (page !== rendered || page === null) {
        if (page) paint(page, state.pageNumber); else empty(state.phase === 'loading' ? `Loading ${resource}…` : `No ${resource} loaded.`);
        rendered = page;
      }
      status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
      const info = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} ${resource}` : '';
      const previousPage = `Previous ${parameter ? 'parameter' : 'override'} page shown.`;
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ` ${previousPage} ` : ' '}${info}`
        : state.stale ? `Refreshing… ${previousPage} ${info}` : state.phase === 'loading' ? `Loading ${resource}…` : info;
      if (panel.hidden && panelFocused && permitted) toggle.focus({ preventScroll: true });
      else if (focused === retry && retry.hidden) toggle.focus({ preventScroll: true });
      else if (rowFocused && permitted) {
        let hidden = !focused.isConnected; for (let node = focused; node && node !== body; node = node.parentElement) hidden ||= node.hidden;
        if (hidden || document.activeElement !== focused) (hidden ? scroll : focused).focus({ preventScroll: true });
      }
      scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
      if (returning && page && !busy) {
        for (const id of returning.values ?? []) if (rows.has(id) && !rows.get(id).value.hidden) rows.get(id).value.open = true;
        for (const id of returning[extraKey] ?? []) if (rows.has(id)) rows.get(id).details.open = true;
        if (document.activeElement === initialFocus) {
          const row = rows.get(returning.valueFocus);
          ((!row?.value.hidden && row?.valueSummary) || rows.get(returning[extraFocus])?.summary || controls[returning.focus]
            || ((returning.valueFocus || returning[extraFocus]) ? scroll : null))?.focus({ preventScroll: true });
        }
        if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) {
          scroll.scrollLeft = returning.left; scroll.scrollTop = returning.top;
        }
        returning = null;
      }
    },
    checkpoint() {
      return { left: scroll.scrollLeft, top: scroll.scrollTop,
        values: [...rows].filter(([, row]) => row.value.open).map(([id]) => id), [extraKey]: [...rows].filter(([, row]) => row.details.open).map(([id]) => id),
        valueFocus: [...rows].find(([, row]) => row.valueSummary === document.activeElement)?.[0] ?? null,
        [extraFocus]: [...rows].find(([, row]) => row.summary === document.activeElement)?.[0] ?? null,
        focus: Object.keys(controls).find(key => controls[key] === document.activeElement) ?? null };
    },
    dispose() {
      for (const [node, event, handler] of listeners) node.removeEventListener(event, handler);
      rows.clear(); body.replaceChildren(); status.textContent = notice.textContent = status.title = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true;
      current = returning = rendered = null;
    },
  };
}

export const mountParameters = (root, options) => mountValueTable(root, options, 'parameters');
export const mountOverrides = (root, options) => mountValueTable(root, options, 'overrides');
