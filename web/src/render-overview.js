import { createDisplay, formatCode, formatId } from './display.js';
import { createOverview } from './overview.js';

export function mountOverview(root, { api, metadata, executionBase }) {
  const document = root.ownerDocument;
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const table = root.querySelector('[data-execution-table]');
  const body = table.querySelector('tbody');
  const listStatus = root.querySelector('[data-executions-status]');
  const summaryStatus = root.querySelector('[data-summary-status]');
  const listRetry = root.querySelector('[data-list-retry]');
  const summaryRetry = root.querySelector('[data-summary-retry]');
  const bounds = root.querySelector('[data-cohort-window]');
  const header = root.querySelector('[data-app-status]');
  const previous = root.querySelector('[data-executions-previous]');
  const next = root.querySelector('[data-executions-next]');
  const latest = root.querySelector('[data-executions-latest]');
  const pageNotice = root.querySelector('[data-page-notice]');
  const cards = Object.fromEntries(['total', 'running', 'succeeded', 'failed']
    .map((key) => [key, root.querySelector(`[data-count="${key}"]`)]));
  let renderedPage = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function time(value) {
    if (value === null) return document.createTextNode('—');
    const node = element('time', display.timestamp(value));
    node.dateTime = value;
    node.title = value;
    return node;
  }

  function empty(message) {
    const row = element('tr');
    const cell = element('td', message, 'empty-state');
    cell.colSpan = 9;
    row.append(cell);
    body.replaceChildren(row);
  }

  function renderRows(page, pageNumber) {
    if (!page.data.length) {
      empty(pageNumber > 1 ? 'No executions remain on this page. Use Previous or Show latest.'
        : 'No executions match these filters.');
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of page.data) {
      const row = element('tr');
      row.dataset.executionId = item.execution_id;
      const identity = element('td');
      const link = element('a', formatId(item.execution_id));
      link.href = executionBase + item.execution_id;
      identity.append(link);
      const scope = element('td', undefined, 'name-cell');
      scope.append(element('span', item.folder_name), element('span', item.project_name, 'cell-detail'));
      const created = element('td', undefined, 'time-cell');
      created.append(time(item.created_at));
      const started = element('td', undefined, 'time-cell');
      started.append(time(item.started_at));
      const duration = element('td', display.duration(item.duration_seconds), 'number-cell');
      if (item.ended_at === null && item.elapsed_seconds !== null) {
        duration.append(element('span', `Elapsed: ${display.duration(item.elapsed_seconds)}`, 'cell-detail'));
      }
      row.append(identity, scope, element('td', item.package_name, 'name-cell'),
        element('td', formatCode(item.status)), created, started, duration,
        element('td', display.count(item.warning_count), 'number-cell'),
        element('td', display.count(item.error_count), 'number-cell'));
      fragment.append(row);
    }
    body.replaceChildren(fragment);
  }

  function failure(error) {
    return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  }

  const owner = createOverview({ api, metadata, publish(state) {
    const page = state.page;
    table.setAttribute('aria-busy', String(state.phase === 'loading-list'));
    root.querySelector('[data-summary]').setAttribute('aria-busy', String(state.phase === 'loading-summary'));
    listRetry.hidden = state.phase !== 'list-error';
    summaryRetry.hidden = state.phase !== 'summary-error';
    previous.disabled = !state.hasPrevious;
    next.disabled = !state.hasNext;
    latest.disabled = state.selection === null || ['loading-list', 'loading-summary'].includes(state.phase);
    pageNotice.textContent = state.notice;
    header.textContent = ({ idle: 'No selection', 'loading-list': 'Loading executions…',
      'loading-summary': 'Loading summary…', ready: 'Loaded', 'list-error': 'Executions unavailable',
      'summary-error': 'Summary unavailable' })[state.phase];
    if (page !== renderedPage) {
      if (page) renderRows(page, state.pageNumber);
      else empty(state.phase === 'loading-list' ? 'Loading executions…' : 'No data loaded.');
      renderedPage = page;
    } else if (page === null) {
      empty(state.phase === 'loading-list' ? 'Loading executions…'
        : state.phase === 'list-error' ? 'Executions could not be loaded.' : 'No data loaded.');
    }
    listStatus.textContent = state.phase === 'list-error' ? failure(state.error)
      : page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} rows · Live results` : '';
    summaryStatus.textContent = state.phase === 'summary-error' ? failure(state.error)
      : state.phase === 'loading-summary' ? 'Loading summary…' : '';
    bounds.hidden = page === null;
    if (page) {
      bounds.replaceChildren(document.createTextNode('Created: '), time(page.meta.from),
        document.createTextNode(' → '), time(page.meta.to), document.createTextNode(' (exclusive)'));
    } else bounds.replaceChildren();
    const counts = state.summary ? Object.fromEntries(state.summary.data.by_status.map((item) => [item.code, item.count])) : null;
    const values = state.summary ? { total: state.summary.data.total, running: counts[2], succeeded: counts[7], failed: counts[4] } : null;
    for (const [key, node] of Object.entries(cards)) {
      node.textContent = values ? display.count(values[key]) : '—';
      if (values) node.removeAttribute('aria-label');
      else node.setAttribute('aria-label', 'Not loaded');
    }
  } });
  const retryList = () => { void owner.retryList(); };
  const retrySummary = () => { void owner.retrySummary(); };
  const previousPage = () => { void owner.previous(); };
  const nextPage = () => { void owner.next(); };
  const latestPage = () => { void owner.latest(); };
  previous.addEventListener('click', previousPage);
  next.addEventListener('click', nextPage);
  latest.addEventListener('click', latestPage);
  listRetry.addEventListener('click', retryList);
  summaryRetry.addEventListener('click', retrySummary);
  return {
    apply: owner.apply,
    dispose() {
      owner.dispose();
      listRetry.removeEventListener('click', retryList);
      summaryRetry.removeEventListener('click', retrySummary);
      previous.removeEventListener('click', previousPage);
      next.removeEventListener('click', nextPage);
      latest.removeEventListener('click', latestPage);
    },
  };
}
