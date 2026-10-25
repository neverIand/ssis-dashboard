import { eventQuery } from './events.js';
import { mountSectionTable } from './section-table.js';

export function mountEvents(root, { metadata, actions, restoreView = null }) {
  const enabled = metadata.capabilities.events;
  const view = mountSectionTable(root, { metadata, actions, restoreView }, {
    resource: 'events',
    columns: 3,
    identity: 'event_id',
    enabled,
    capability: true,
    controlNames: [
      'toggle',
      'retry',
      'previous',
      'next',
      'latest',
      'sort',
      'limit',
      'kind',
      'q',
      'apply',
      'reset',
      'scroll'
    ],
    sorts: [{ key: 'message_time', label: 'Time', header: true }, { key: 'event_id', label: 'Event ID' }],
    disclosures: [{
      saved: 'messages',
      field: 'message',
      focus: 'messageFocus',
      summary: 'messageSummary',
      visible: true
    }, { saved: 'sources', field: 'details', focus: 'sourceFocus', summary: 'summary' }],
    focusFallback: ['messageFocus', 'sourceFocus']
  });
  const { get, controls, rows, display, element, text, listen, notice, status } = view;
  const { kind, q, apply, reset } = controls;
  const form = get('filters');
  let applied = null;
  const literal = (value) => value === null ? '—' : value === '' ? '(empty)' : String(value);
  const label = (value) => value === 'all' ? 'All events' : value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
  // Replace, not append: a back/forward-cache restore mounts this view again on the same DOM.
  kind.replaceChildren(...metadata.event_kinds.map((value) => {
    const option = element('option', label(value));
    option.value = value;
    return option;
  }));
  q.value = view.returning?.draft?.q ?? '';
  kind.value = 'all';
  const showDraft = () => {
    apply.className = q.value !== (applied?.q ?? '') ? 'button-primary' : '';
  };
  const fields = [
    ['event_id', 'Event ID'],
    ['message_type', 'Message type'],
    ['package_name', 'Package'],
    ['package_path', 'Package path'],
    ['execution_path', 'Execution path'],
    ['source_name', 'Source'],
    ['source_type', 'Source type'],
    ['subcomponent_name', 'Subcomponent']
  ];
  function paintRow(item, row, executionStart) {
    if (!row) {
      const node = element('tr');
      node.dataset.eventId = item.event_id;
      const cells = Array.from({ length: 3 }, (_, i) => element('td', undefined, i === 0 ? 'time-cell' : ''));
      const time = element('time'), name = element('span');
      cells[0].append(time);
      cells[1].className = 'event-name';
      cells[1].append(name);
      const preview = element('p', undefined, 'event-preview'), message = element('details');
      const messageSummary = element('summary', 'View message'), full = element('p', undefined, 'event-body bounded-detail');
      full.tabIndex = 0;
      full.setAttribute('role', 'region');
      full.setAttribute('aria-label', 'Event message');
      const truncated = element('p', undefined, 'cell-detail');
      message.append(messageSummary, full);
      cells[2].append(preview, truncated, message);
      const details = element('details'), summary = element('summary', 'Source');
      const list = element('dl', undefined, 'observation-paths bounded-detail'), values = {};
      list.tabIndex = 0;
      list.setAttribute('role', 'region');
      list.setAttribute('aria-label', 'Event source details');
      for (const [key, title] of fields) {
        values[key] = element('dd');
        list.append(element('dt', title), values[key]);
      }
      details.append(summary, list);
      cells[1].append(details);
      node.append(...cells);
      row = {
        node,
        cells,
        time,
        name,
        preview,
        message,
        messageSummary,
        full,
        truncated,
        details,
        summary,
        values
      };
      rows.set(item.event_id, row);
    }
    text(row.time, display.tableTimestamp(item.message_time, executionStart));
    row.time.setAttribute('datetime', item.message_time);
    row.time.title = item.message_time;
    text(row.name, literal(item.event_name));
    row.node.dataset.severity = ['OnError',
      'OnTaskFailed'].includes(item.event_name) ? 'error' : item.event_name === 'OnWarning' ? 'warning' : 'none';
    const characters = item.message === null ? [] : [...item.message];
    text(row.preview, characters.length > 160 ? characters.slice(0, 160).join('') + '…' : literal(item.message));
    text(row.full, literal(item.message));
    row.message.hidden = characters.length <= 160 && !item.truncated;
    if (row.message.hidden) row.message.open = false;
    row.truncated.hidden = !item.truncated;
    text(row.truncated,
      item.truncated ? `Truncated to ${metadata.limits.max_text_characters} characters. Search includes the full message.` : '');
    for (const [key] of fields) text(row.values[key], literal(item[key]));
    return row;
  }
  listen(q, 'input', showDraft);
  listen(form, 'submit', (event) => {
    event.preventDefault();
    if (!view.state || !view.state.open || !enabled) return;
    try {
      actions.apply(eventQuery({ ...view.state.query, q: q.value }, metadata));
    } catch {
      notice.textContent = `Enter a supported category and valid search text of at most ${
        metadata.limits.max_search_characters} characters.`;
    }
  });
  listen(kind, 'change', () => {
    if (!view.state?.open || !enabled) return;
    try {
      actions.apply(eventQuery({ ...view.state.query, kind: kind.value }, metadata));
    } catch {
      kind.value = view.state.query.kind;
    }
  });
  listen(reset, 'click', () => {
    kind.value = 'all';
    q.value = '';
    actions.apply({ kind: 'all', q: null });
  });
  return view.mount({
    paintRow,
    disabled: [kind, q, apply, reset],
    loading: 'Loading events…',
    notLoaded: 'No events loaded.',
    previousPage: 'Previous event page shown.',
    emptyMessage: (page, number) => number > 1 ? 'No events remain on this page. Use Previous or First page.'
      : page.meta.availability === 'not-recorded' ? 'No events recorded. Logging was disabled.'
        : page.meta.availability === 'unknown' ? 'No matching events. Recording coverage is unknown.' : 'No matching events.',
    filters(state, returning) {
      kind.value = state.query.kind;
      if (!applied && !returning?.draft || applied && applied.q !== state.query.q) q.value = state.query.q ?? '';
      applied = state.query;
      reset.hidden = applied.kind === 'all' && applied.q === null;
      showDraft();
    },
    pageInfo(page, state) {
      const coverage = page.meta.availability === 'available' ? '' : page.meta.availability === 'not-recorded' ? ' · Not recorded'
        : ' · Recording coverage unknown';
      return `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} events${coverage}`
        + (page.meta.has_unidentified_events ? ' · Some matching events have no public numeric ID and cannot be paged.' : '');
    },
    checkpoint: () => ({ draft: { q: q.value } }),
    clearStatus() {
      status.textContent = notice.textContent = q.value = status.title = '';
    },
    dispose() {
      applied = null;
    }
  });
}
