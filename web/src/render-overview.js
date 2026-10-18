import { createDisplay, formatCode, formatId } from './display.js';
import { createOverview } from './overview.js';
import { selectionParams } from './selection.js';

export function mountOverview(root, { api, metadata, executionBase, retainedPaths, restoreView = null }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
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
  const refresh = root.querySelector('[data-overview-refresh]');
  const pollToggle = root.querySelector('[data-poll-toggle]');
  const pollStatus = root.querySelector('[data-poll-status]');
  const pollTime = new Intl.DateTimeFormat(undefined, { timeZone: metadata.display_timezone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  const scroll = table.parentElement;
  const rows = new Map();
  const cards = Object.fromEntries(['total', 'running', 'succeeded', 'failed']
    .map((key) => [key, root.querySelector(`[data-count="${key}"]`)]));
  let renderedPage = null;
  let returning = restoreView;
  let selectionKey = null;
  let autoPaused = restoreView?.autoPaused === true;

  function position() {
    return { x: window.scrollX, y: window.scrollY, left: scroll.scrollLeft, top: scroll.scrollTop };
  }

  function restorePosition(value) {
    scroll.scrollLeft = value.left;
    scroll.scrollTop = value.top;
    if (window.scrollX !== value.x || window.scrollY !== value.y) window.scrollTo(value.x, value.y);
  }

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
    rows.clear();
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
    if (!rows.size) body.replaceChildren();
    const wanted = new Set();
    let cursor = body.firstChild;
    for (const item of page.data) {
      wanted.add(item.execution_id);
      let record = rows.get(item.execution_id);
      if (!record) {
        const row = element('tr');
        row.dataset.executionId = item.execution_id;
        const cells = Array.from({ length: 9 }, (_, index) => element('td', undefined,
          [1, 2].includes(index) ? 'name-cell' : [4, 5].includes(index) ? 'time-cell' : index >= 6 ? 'number-cell' : ''));
        const link = element('a', formatId(item.execution_id));
        link.href = executionBase + item.execution_id;
        cells[0].append(link);
        cells[1].append(element('span'), element('span', undefined, 'cell-detail'));
        row.append(...cells);
        record = { row, cells, item: null };
        rows.set(item.execution_id, record);
      }
      const { row, cells, item: previous } = record;
      const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
      text(cells[1].children[0], item.folder_name);
      text(cells[1].children[1], item.project_name);
      text(cells[2], item.package_name);
      text(cells[3], formatCode(item.status));
      for (const [index, key] of [[4, 'created_at'], [5, 'started_at']]) {
        if (previous?.[key] !== item[key]) cells[index].replaceChildren(time(item[key]));
      }
      if (!previous || ['duration_seconds', 'elapsed_seconds', 'ended_at'].some((key) => previous[key] !== item[key])) {
        cells[6].replaceChildren(document.createTextNode(display.duration(item.duration_seconds)));
        if (item.ended_at === null && item.elapsed_seconds !== null) {
          cells[6].append(element('span', `Elapsed: ${display.duration(item.elapsed_seconds)}`, 'cell-detail'));
        }
      }
      text(cells[7], display.count(item.warning_count));
      text(cells[8], display.count(item.error_count));
      record.item = item;
      if (row !== cursor) body.insertBefore(row, cursor);
      cursor = row.nextSibling;
    }
    for (const [id, record] of rows) {
      if (!wanted.has(id)) { record.row.remove(); rows.delete(id); }
    }
  }

  function failure(error) {
    return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  }

  const owner = createOverview({ api, metadata, retainedPaths, autoRefresh: !autoPaused,
    visible: document.visibilityState !== 'hidden', publish(state) {
    const page = state.page;
    const refreshing = state.operation === 'refresh' || state.operation === 'summary-retry';
    selectionKey = state.selection === null ? null : JSON.stringify(selectionParams(state.selection));
    if (returning && returning.selectionKey !== selectionKey) returning = null;
    const currentPosition = refreshing && page !== null ? position() : null;
    const focused = document.activeElement;
    const rowFocus = body.contains(focused);
    table.setAttribute('aria-busy', String(state.phase === 'loading-list'));
    root.querySelector('[data-summary]').setAttribute('aria-busy', String(state.phase === 'loading-summary'
      || (refreshing && state.busy)));
    refresh.disabled = state.selection === null;
    refresh.setAttribute('aria-disabled', String(state.busy));
    autoPaused = state.poll.paused;
    pollToggle.disabled = state.selection === null;
    pollToggle.textContent = autoPaused ? 'Resume auto refresh' : 'Pause auto refresh';
    pollStatus.textContent = state.poll.mode === 'scheduled'
      ? `${state.poll.failures ? 'Retry' : 'Next refresh'}: ${pollTime.format(state.poll.nextAt)}.`
      : ({ idle: '', paused: 'Auto refresh paused.', hidden: 'Auto refresh paused while this tab is hidden.',
        updating: 'Auto refresh on.', blocked: 'Auto refresh stopped. Retry or change the selection.' })[state.poll.mode];
    listRetry.hidden = state.phase !== 'list-error';
    summaryRetry.hidden = state.phase !== 'summary-error';
    previous.disabled = !state.hasPrevious;
    next.disabled = !state.hasNext;
    latest.disabled = state.selection === null || ['loading-list', 'loading-summary'].includes(state.phase);
    pageNotice.textContent = state.notice;
    header.textContent = refreshing && state.busy ? 'Refreshing…'
      : state.pageStale ? 'Refresh failed' : ({ idle: 'No selection', 'loading-list': 'Loading executions…',
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
    const pageDetails = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} rows · Updated ${display.timestamp(page.meta.generated_at)} · Live results` : '';
    listStatus.textContent = state.phase === 'list-error'
      ? `${failure(state.error)}${state.pageStale ? ` Previous results shown. ${pageDetails}` : ''}`
      : state.pageStale ? `Refreshing… Previous results shown. ${pageDetails}` : pageDetails;
    const summaryDetails = state.summaryStale ? ` Previous counts shown. Updated ${display.timestamp(state.summary.meta.generated_at)}.` : '';
    summaryStatus.textContent = state.phase === 'summary-error' ? failure(state.error) + summaryDetails
      : state.summaryStale ? 'Refreshing…' + summaryDetails
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
    if (rowFocus && document.activeElement !== focused) {
      (focused.isConnected ? focused : scroll).focus({ preventScroll: true });
    }
    if (currentPosition) restorePosition(currentPosition);
    if (returning && !state.busy && state.selection !== null) {
      if (page) {
        if (returning.focusId !== null || returning.tableFocused) {
          (rows.get(returning.focusId)?.cells[0].firstChild ?? scroll).focus({ preventScroll: true });
        }
        restorePosition(returning.position);
      }
      returning = null;
    }
  } });
  const retryList = () => { void owner.retryList(); };
  const retrySummary = () => { void owner.retrySummary(); };
  const previousPage = () => { void owner.previous(); };
  const nextPage = () => { void owner.next(); };
  const latestPage = () => { void owner.latest(); };
  const refreshPage = () => { void owner.refresh(); };
  const togglePolling = () => owner.togglePolling();
  const visibilityChanged = () => owner.setVisible(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', visibilityChanged);
  pollToggle.addEventListener('click', togglePolling);
  refresh.addEventListener('click', refreshPage);
  previous.addEventListener('click', previousPage);
  next.addEventListener('click', nextPage);
  latest.addEventListener('click', latestPage);
  listRetry.addEventListener('click', retryList);
  summaryRetry.addEventListener('click', retrySummary);
  return {
    apply(selection, options) {
      if (!options?.restore) returning = null;
      return owner.apply(selection, options);
    },
    refresh: owner.refresh,
    checkpoint() {
      const focusId = [...rows].find(([, record]) => record.row.contains(document.activeElement))?.[0] ?? null;
      return { paths: owner.checkpoint(), view: { position: position(), focusId, selectionKey, autoPaused,
        tableFocused: document.activeElement === scroll } };
    },
    dispose() {
      owner.dispose();
      document.removeEventListener('visibilitychange', visibilityChanged);
      pollToggle.removeEventListener('click', togglePolling);
      listRetry.removeEventListener('click', retryList);
      summaryRetry.removeEventListener('click', retrySummary);
      previous.removeEventListener('click', previousPage);
      next.removeEventListener('click', nextPage);
      latest.removeEventListener('click', latestPage);
      refresh.removeEventListener('click', refreshPage);
    },
  };
}
