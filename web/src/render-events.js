import { createDisplay, formatId } from './display.js';
import { eventQuery } from './events.js';

export function mountEvents(root, { metadata, actions, restoreView = null }) {
  const document = root.ownerDocument, enabled = metadata.capabilities.events;
  const get = name => root.querySelector(`[data-events-${name}]`);
  const controls = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'sort', 'direction',
    'limit', 'kind', 'q', 'apply', 'reset', 'scroll'].map(key => [key, get(key)]));
  const { toggle, retry, previous, next, latest, sort, direction, limit, kind, q, apply, reset, scroll } = controls;
  const panel = get('panel'), status = get('status'), notice = get('notice'), scope = get('scope');
  const table = get('table'), body = table.querySelector('tbody'), form = get('filters');
  const display = createDisplay({ timeZone: metadata.display_timezone }), rows = new Map(), listeners = [];
  const initialFocus = document.activeElement, initialScroll = { left: scroll.scrollLeft, top: scroll.scrollTop };
  let returning = enabled ? restoreView : null, current = null, rendered = null, renderedStart = null, applied = null, busy = true;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const literal = value => value === null ? '—' : value === '' ? '(empty)' : String(value);
  const label = value => value === 'all' ? 'All events' : value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
  for (const value of metadata.event_kinds) {
    const option = element('option', label(value)); option.value = value; kind.append(option);
  }
  q.value = returning?.draft?.q ?? ''; kind.value = returning?.draft?.kind ?? 'all';
  limit.max = String(metadata.limits.max_limit);
  const fields = [['package_name', 'Package'], ['package_path', 'Package path'], ['execution_path', 'Execution path'],
    ['source_name', 'Source'], ['source_type', 'Source type'], ['subcomponent_name', 'Subcomponent']];
  function empty(message) {
    rows.clear(); const row = element('tr'), cell = element('td', message, 'empty-state');
    cell.colSpan = 5; row.append(cell); body.replaceChildren(row);
  }
  function paint(page, pageNumber, executionStart) {
    if (!page.data.length) {
      empty(pageNumber > 1 ? 'No events remain on this page. Use Previous or Show latest.'
        : page.meta.availability === 'not-recorded' ? 'No events recorded. Logging was disabled.'
          : page.meta.availability === 'unknown' ? 'No matching events on this page. Recording coverage is unknown.' : 'No matching events on this page.');
      return;
    }
    if (!rows.size) body.replaceChildren();
    let anchor = body.firstChild; const wanted = new Set();
    for (const item of page.data) {
      wanted.add(item.event_id);
      let row = rows.get(item.event_id);
      if (!row) {
        const node = element('tr'); node.dataset.eventId = item.event_id;
        const cells = Array.from({ length: 5 }, (_, i) => element('td', undefined, i === 0 ? 'id-cell' : i === 1 ? 'time-cell' : ''));
        const time = element('time'), name = element('span'), code = element('span', undefined, 'cell-detail');
        cells[1].append(time); cells[2].className = 'event-name'; cells[2].append(name, code);
        const preview = element('p', undefined, 'event-preview'), message = element('details');
        const messageSummary = element('summary', 'View message'), full = element('p', undefined, 'event-body');
        const truncated = element('p', undefined, 'cell-detail'); message.append(messageSummary, full);
        cells[3].append(preview, truncated, message);
        const details = element('details'), summary = element('summary', 'Source');
        const list = element('dl', undefined, 'observation-paths'), values = {};
        for (const [key, title] of fields) { values[key] = element('dd'); list.append(element('dt', title), values[key]); }
        details.append(summary, list); cells[4].append(details); node.append(...cells);
        row = { node, cells, time, name, code, preview, message, messageSummary, full, truncated, details, summary, values };
        rows.set(item.event_id, row);
      }
      text(row.cells[0], formatId(item.event_id)); text(row.time, display.tableTimestamp(item.message_time, executionStart));
      row.time.setAttribute('datetime', item.message_time); row.time.title = item.message_time;
      text(row.name, literal(item.event_name)); text(row.code, `Message type: ${item.message_type}`);
      row.node.dataset.severity = ['OnError', 'OnTaskFailed'].includes(item.event_name) ? 'error'
        : item.event_name === 'OnWarning' ? 'warning' : 'none';
      const characters = item.message === null ? [] : [...item.message];
      text(row.preview, characters.length > 160 ? characters.slice(0, 160).join('') + '…' : literal(item.message));
      text(row.full, literal(item.message)); row.message.hidden = characters.length <= 160 && !item.truncated;
      if (row.message.hidden) row.message.open = false;
      row.truncated.hidden = !item.truncated;
      text(row.truncated, item.truncated ? `Truncated to ${metadata.limits.max_text_characters} characters. Search includes the full message.` : '');
      for (const [key] of fields) text(row.values[key], literal(item[key]));
      if (row.node !== anchor) body.insertBefore(row.node, anchor);
      anchor = row.node.nextSibling;
    }
    for (const [id, row] of rows) if (!wanted.has(id)) { row.node.remove(); rows.delete(id); }
  }
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push([node, event, handler]); };
  listen(toggle, 'click', actions.toggle); listen(retry, 'click', actions.retry);
  listen(previous, 'click', actions.previous); listen(next, 'click', actions.next); listen(latest, 'click', actions.latest);
  listen(form, 'submit', event => {
    event.preventDefault(); if (!current || !current.open || !enabled) return;
    try { actions.apply(eventQuery({ ...current.query, kind: kind.value, q: q.value }, metadata)); }
    catch { notice.textContent = `Enter a supported category and valid search text of at most ${metadata.limits.max_search_characters} characters.`; }
  });
  listen(reset, 'click', () => { kind.value = 'all'; q.value = ''; actions.apply({ kind: 'all', q: null }); });
  for (const node of [sort, direction, limit]) listen(node, 'change', () => {
    if (busy || !current) return;
    try { actions.order(eventQuery({ ...current.query, sort: sort.value, direction: direction.value, limit: Number(limit.value) }, metadata)); }
    catch { notice.textContent = `Rows per page must be between 1 and ${metadata.limits.max_limit}.`; }
  });
  return {
    render(state, isBusy, authorized, executionStart = null) {
      current = state; busy = isBusy;
      const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
      const position = { left: scroll.scrollLeft, top: scroll.scrollTop }, permitted = enabled && authorized;
      if (!state.open) returning = null;
      get('unavailable').hidden = enabled;
      panel.hidden = !state.open || !permitted;
      for (const node of [retry, previous, next, latest, sort, direction, limit, kind, q, apply, reset]) node.disabled = panel.hidden;
      for (const node of [retry, sort, direction, limit, latest]) node.setAttribute('aria-disabled', String(busy));
      previous.setAttribute('aria-disabled', String(busy || !state.hasPrevious)); next.setAttribute('aria-disabled', String(busy || !state.hasNext));
      table.setAttribute('aria-busy', String(busy)); retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      for (const [node, value] of [[sort, state.query.sort], [direction, state.query.direction], [limit, String(state.query.limit)]]) {
        if (document.activeElement !== node) node.value = value;
      }
      if ((!applied && !returning?.draft) || (applied && (applied.kind !== state.query.kind || applied.q !== state.query.q))) {
        kind.value = state.query.kind; q.value = state.query.q ?? '';
      }
      applied = state.query;
      scope.textContent = panel.hidden ? '' : [applied.kind === 'all' ? '' : label(applied.kind),
        applied.q === null ? '' : `Search: ${JSON.stringify(applied.q)}`].filter(Boolean).join(' · ');
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      if (page !== rendered || page === null || executionStart !== renderedStart) {
        if (page) paint(page, state.pageNumber, executionStart); else empty(state.phase === 'loading' ? 'Loading events…' : 'No events loaded.');
        rendered = page;
        renderedStart = executionStart;
      }
      status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
      const coverage = page?.meta.availability === 'available' ? '' : page?.meta.availability === 'not-recorded' ? ' · Not recorded' : ' · Recording coverage unknown';
      const info = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} events${coverage}${page.meta.has_unidentified_events ? ' · Some matching events have no public numeric ID and cannot be paged.' : ''}` : '';
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ' Previous event page shown. ' : ' '}${info}`
        : state.stale ? `Refreshing… Previous event page shown. ${info}` : state.phase === 'loading' ? 'Loading events…' : info;
      if (panel.hidden && panelFocused && permitted) toggle.focus({ preventScroll: true });
      else if (focused === retry && retry.hidden) toggle.focus({ preventScroll: true });
      else if (rowFocused && permitted) {
        let hidden = !focused.isConnected; for (let node = focused; node && node !== body; node = node.parentElement) hidden ||= node.hidden;
        if (hidden || document.activeElement !== focused) (hidden ? scroll : focused).focus({ preventScroll: true });
      }
      scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
      if (returning && page && !busy) {
        for (const id of returning.messages ?? []) if (rows.has(id) && !rows.get(id).message.hidden) rows.get(id).message.open = true;
        for (const id of returning.sources ?? []) if (rows.has(id)) rows.get(id).details.open = true;
        if (document.activeElement === initialFocus) {
          const row = rows.get(returning.messageFocus);
          ((!row?.message.hidden && row?.messageSummary) || rows.get(returning.sourceFocus)?.summary || controls[returning.focus]
            || ((returning.messageFocus || returning.sourceFocus) ? scroll : null))?.focus({ preventScroll: true });
        }
        if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) {
          scroll.scrollLeft = returning.left; scroll.scrollTop = returning.top;
        }
        returning = null;
      }
    },
    checkpoint() {
      return { draft: { kind: kind.value, q: q.value }, left: scroll.scrollLeft, top: scroll.scrollTop,
        messages: [...rows].filter(([, row]) => row.message.open).map(([id]) => id),
        sources: [...rows].filter(([, row]) => row.details.open).map(([id]) => id),
        messageFocus: [...rows].find(([, row]) => row.messageSummary === document.activeElement)?.[0] ?? null,
        sourceFocus: [...rows].find(([, row]) => row.summary === document.activeElement)?.[0] ?? null,
        focus: Object.keys(controls).find(key => controls[key] === document.activeElement) ?? null };
    },
    dispose() {
      for (const [node, event, handler] of listeners) node.removeEventListener(event, handler);
      rows.clear(); body.replaceChildren(); status.textContent = notice.textContent = scope.textContent = q.value = status.title = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true;
      current = returning = rendered = applied = null;
    },
  };
}
