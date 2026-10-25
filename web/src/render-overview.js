import { createDisplay, formatCode, formatId, refreshStatus } from './display.js';
import { executionHref } from './detail-navigation.js';
import { createOverview } from './overview.js';
import { selectionParams, selectionSearch } from './selection.js';
import { mountTimeline } from './render-timeline.js';
import { reserveLoadingSpace } from './loading-space.js';
import { inlineStatus, pollingButton } from './ui.js';

export function mountOverview(root, { api, metadata, appBase, retainedPaths, restoreView = null,
  serverTime = null, onSelect = () => {} }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const table = root.querySelector('[data-execution-table]');
  const body = table.querySelector('tbody');
  const listStatus = root.querySelector('[data-executions-status]');
  const otherNote = root.querySelector('[data-summary-other-note]');
  const listRetry = root.querySelector('[data-list-retry]');
  const bounds = root.querySelector('[data-cohort-window]');
  const previous = root.querySelector('[data-executions-previous]');
  const next = root.querySelector('[data-executions-next]');
  const latest = root.querySelector('[data-executions-latest]');
  const pageNotice = root.querySelector('[data-page-notice]');
  const refresh = root.querySelector('[data-overview-refresh]');
  const pollToggle = root.querySelector('[data-poll-toggle]');
  const pollStatus = root.querySelector('[data-poll-status]');
  const scroll = table.parentElement;
  const reserveSpace = reserveLoadingSpace(scroll);
  const rows = new Map();
  const cards = Object.fromEntries(['total', 'running', 'succeeded', 'failed', 'other']
    .map((key) => [key, root.querySelector(`[data-count="${key}"]`)]));
  const statusSets = { total: [], running: [2], succeeded: [7], failed: [4],
    other: metadata.execution_statuses.map(item => item.code).filter(code => ![2,4,7].includes(code)).sort((a,b) => a-b) };
  const cardLinks = Object.fromEntries(Object.keys(cards).map(key => [key, root.querySelector(`[data-status-card="${key}"]`)]));
  let appliedSelection = null, summaryAvailable = false;
  let renderedPage = null;
  let returning = restoreView;
  let selectionKey = null;
  let autoPaused = restoreView?.autoPaused === true;
  let phase = 'idle';
  const timelineView=mountTimeline(root,{metadata,restoreView:restoreView?.timeline,
    actions:{toggle:()=>{void owner.toggleTimeline();},retry:()=>{void owner.retryTimeline();},
      bucket:value=>{void owner.setTimelineBucket(value);}}});

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

  function intercept(event, changes) {
    if ((event.button ?? 0) !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (appliedSelection) onSelect(changes);
  }
  function linkSelection(node, selection, changes) {
    const href = appBase + selectionSearch({ ...selection, ...changes }, metadata);
    if (node.getAttribute('href') !== href) node.setAttribute('href', href);
  }
  const cardActions = Object.entries(cardLinks).map(([key, node]) => {
    const action = event => {
      if (summaryAvailable && (statusSets[key].length || key === 'total')) intercept(event, { status: statusSets[key] });
      else event.preventDefault();
    };
    node.addEventListener('click', action);
    return [node, action];
  });

  function empty(message) {
    rows.clear();
    const row = element('tr');
    const cell = element('td', message, 'empty-state');
    cell.colSpan = 9;
    row.append(cell);
    body.replaceChildren(row);
  }

  function renderRows(page, pageNumber, selection) {
    if (!page.data.length) {
      empty(pageNumber > 1 ? 'No executions remain on this page. Use Previous or First page.'
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
          index === 0 ? 'id-cell' : index === 1 ? 'name-cell' : index === 2 ? 'name-cell package-cell'
            : [4, 5].includes(index) ? 'time-cell' : index >= 6 ? 'number-cell' : ''));
        const link = element('a', formatId(item.execution_id));
        link.dataset.executionLink = ''; link.dataset.executionId = item.execution_id;
        cells[0].append(link);
        const folder = element('a'), project = element('a', undefined, 'cell-detail');
        folder.dataset.selectionLink = ''; project.dataset.selectionLink = '';
        cells[1].append(folder, project);
        const packageLink = element('a');
        packageLink.dataset.executionLink = ''; packageLink.dataset.executionId = item.execution_id;
        cells[2].append(packageLink);
        cells[3].append(element('span', undefined, 'status-badge'));
        for (const index of [7, 8]) {
          const count = element('a');
          count.dataset.executionLink = ''; count.dataset.executionId = item.execution_id;
          cells[index].append(count);
        }
        row.append(...cells);
        record = { row, cells, item: null };
        folder.addEventListener('click', event => intercept(event, { folder: record.item.folder_name, project: null }));
        project.addEventListener('click', event => intercept(event, { folder: record.item.folder_name,
          project: record.item.project_name }));
        rows.set(item.execution_id, record);
      }
      const { row, cells, item: previous } = record;
      const href = executionHref(item.execution_id, selection, { appBase, origin: window.location.origin, metadata });
      if (cells[0].firstChild.getAttribute('href') !== href) cells[0].firstChild.setAttribute('href', href);
      if (cells[2].firstChild.getAttribute('href') !== href) cells[2].firstChild.setAttribute('href', href);
      const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
      text(cells[1].children[0], item.folder_name);
      text(cells[1].children[1], item.project_name);
      text(cells[2].firstChild, item.package_name);
      linkSelection(cells[1].children[0], selection, { folder: item.folder_name, project: null });
      linkSelection(cells[1].children[1], selection, { folder: item.folder_name, project: item.project_name });
      text(cells[3].firstChild, formatCode(item.status));
      cells[3].firstChild.dataset.status = String(item.status?.code ?? '');
      for (const [index, key] of [[4, 'created_at'], [5, 'started_at']]) {
        if (previous?.[key] !== item[key]) cells[index].replaceChildren(time(item[key]));
      }
      if (!previous || ['duration_seconds', 'elapsed_seconds', 'ended_at'].some((key) => previous[key] !== item[key])) {
        cells[6].replaceChildren(document.createTextNode(display.duration(item.duration_seconds)));
        if (item.ended_at === null && item.elapsed_seconds !== null) {
          cells[6].append(element('span', `Elapsed: ${display.duration(item.elapsed_seconds)}`, 'cell-detail'));
        }
      }
      for (const [index, kind, count] of [[7, 'warnings', item.warning_count], [8, 'errors', item.error_count]]) {
        const link = cells[index].firstChild;
        text(link, display.count(count));
        const target = executionHref(item.execution_id, selection,
          { appBase, origin: window.location.origin, metadata,
            section: metadata.capabilities.events ? { tab: 'events', kind } : null });
        if (link.getAttribute('href') !== target) link.setAttribute('href', target);
        link.setAttribute('aria-label', `${display.count(count)} ${kind} for execution ${item.execution_id}`);
      }
      cells[7].dataset.level = item.warning_count > 0 ? 'warning' : 'quiet';
      cells[8].dataset.level = item.error_count > 0 ? 'error' : 'quiet';
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

  const owner = createOverview({ api, metadata, retainedPaths, serverTime, autoRefresh: !autoPaused, restoreTimeline:restoreView?.timeline,
    visible: document.visibilityState !== 'hidden', publish(state) {
    const page = state.page;
    phase = state.phase;
    reserveSpace(state.phase === 'loading-list' && page === null, renderedPage !== null);
    const refreshing = state.operation === 'refresh' || state.operation === 'summary-retry';
    appliedSelection = state.selection;
    selectionKey = state.selection === null ? null : JSON.stringify({ ...selectionParams(state.selection),
      created: state.selection.created ?? null });
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
    pollingButton(pollToggle, autoPaused);
    listRetry.hidden = state.phase !== 'list-error' && !(state.busy && !listRetry.hidden);
    listRetry.disabled = state.selection === null;
    listRetry.setAttribute('aria-disabled', String(state.busy));
    // Native disabling blurs a focused button on every automatic refresh. Keep
    // paging focusable; the owner rejects busy and unavailable page actions.
    for (const control of [previous, next, latest]) control.disabled = state.selection === null;
    previous.setAttribute('aria-disabled', String(!state.hasPrevious));
    next.setAttribute('aria-disabled', String(!state.hasNext));
    latest.setAttribute('aria-disabled', String(state.busy || state.selection === null));
    pageNotice.textContent = state.notice;
    if (page !== renderedPage) {
      if (page) renderRows(page, state.pageNumber, state.selection);
      else empty(state.phase === 'loading-list' ? 'Loading executions…' : 'No data loaded.');
      renderedPage = page;
    } else if (page === null) {
      empty(state.phase === 'loading-list' ? 'Loading executions…'
        : state.phase === 'list-error' ? 'Executions could not be loaded.' : 'No data loaded.');
    }
    const pageDetails = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} rows` : '';
    const error = ['list-error', 'summary-error'].includes(state.phase) ? failure(state.error) : '';
    const errorDetails = error ? [error, state.pageStale ? 'Previous results shown.' : '',
      state.summaryStale ? 'Previous counts shown.' : ''].filter(Boolean).join(' ') : '';
    listStatus.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
    listStatus.textContent = error
      ? [errorDetails, pageDetails].filter(Boolean).join(' ')
      : state.pageStale ? `Refreshing… Previous results shown. ${pageDetails}`
      : state.phase === 'loading-list' ? 'Loading executions…' : pageDetails || 'No selection';
    listStatus.title = [listStatus.textContent, listStatus.title].filter(Boolean).join(' · ');
    const stale = state.pageStale || state.summaryStale;
    const failedObservation = state.phase === 'summary-error' ? state.summary : page;
    const refreshText = page ? refreshStatus(display, page.meta.generated_at, state.poll) : '';
    const message = error ? (stale && failedObservation
      ? `⚠ Refresh failed · showing data from ${display.clock(failedObservation.meta.generated_at)}`
      : `⚠ ${state.phase === 'summary-error' ? 'Summary' : 'Executions'} unavailable`)
      : stale ? 'Refreshing… Previous counts shown.'
      : !page ? (state.selection ? 'Loading executions…' : 'No selection')
      : state.phase === 'loading-summary' ? 'Loading summary…' : refreshText;
    inlineStatus(pollStatus, message, [errorDetails,
      page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '',
      state.summaryStale && state.summary
        ? `Counts observed ${display.timestamp(state.summary.meta.generated_at)} · ${state.summary.meta.generated_at}` : '',
      message !== refreshText ? refreshText : ''].filter(Boolean).join(' · '));
    bounds.hidden = false;
    if (page) {
      bounds.replaceChildren(document.createTextNode('Created '), time(page.meta.from),
        document.createTextNode(' → '), time(page.meta.to));
    } else bounds.replaceChildren();
    bounds.title = page ? `${bounds.textContent} (exclusive)` : '';
    const counts = state.summary ? Object.fromEntries(state.summary.data.by_status.map((item) => [item.code, item.count])) : null;
    const values = state.summary ? { total: state.summary.data.total, running: counts[2], succeeded: counts[7], failed: counts[4],
      other: state.summary.data.by_status.filter(item => ![2,4,7].includes(item.code)).reduce((total,item) => total + item.count,
        0) } : null;
    summaryAvailable = values !== null;
    for (const [key, node] of Object.entries(cards)) {
      node.textContent = values ? display.count(values[key]) : '—';
      if (values) node.removeAttribute('aria-label');
      else node.setAttribute('aria-label', 'Not loaded');
      const link = cardLinks[key];
      const available = values !== null && (key === 'total' || statusSets[key].length > 0);
      link.setAttribute('aria-disabled', String(!available));
      // Keep a disabled link focusable while its summary reloads. The click
      // guard above prevents activation until fresh counts are available.
      if (state.selection && (key === 'total' || statusSets[key].length)) linkSelection(link, state.selection, { status: statusSets[key] });
      else link.removeAttribute('href');
      if (state.selection &&
        JSON.stringify(state.selection.status) === JSON.stringify(statusSets[key])) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    if (values) cardLinks.other.hidden = values.other === 0;
    else if (!state.busy) cardLinks.other.hidden = true;
    if (cardLinks.other.hidden && focused === cardLinks.other && state.selection) cardLinks.total.focus({ preventScroll: true });
    const unknownCount = state.summary?.data.by_status.filter(item => !metadata.execution_statuses.some(status =>
      status.code === item.code))
      .reduce((total,item) => total + item.count, 0) ?? 0;
    otherNote.hidden = unknownCount === 0;
    otherNote.textContent = unknownCount
      ? `Other includes ${display.count(unknownCount)} executions with unknown status codes; its filter selects supported statuses.` : '';
    cardLinks.other.title = 'Other supported statuses: ' + metadata.execution_statuses.filter(item =>
      statusSets.other.includes(item.code)).map(formatCode).join(', ')
      + (unknownCount ? `. Counts include ${display.count(unknownCount)} unknown codes, which the API cannot filter.` : '');
    timelineView.render(state.timeline,state.busy,state.selection,page);
    if (focused === listRetry && listRetry.hidden) refresh.focus({ preventScroll: true });
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
  const previousPage = () => { void owner.previous(); };
  const nextPage = () => { void owner.next(); };
  const latestPage = () => { void owner.latest(); };
  const refreshPage = () => { void (phase === 'summary-error' ? owner.retrySummary() : owner.refresh()); };
  const togglePolling = () => owner.togglePolling();
  const visibilityChanged = () => owner.setVisible(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', visibilityChanged);
  pollToggle.addEventListener('click', togglePolling);
  refresh.addEventListener('click', refreshPage);
  previous.addEventListener('click', previousPage);
  next.addEventListener('click', nextPage);
  latest.addEventListener('click', latestPage);
  listRetry.addEventListener('click', retryList);
  return {
    apply(selection, options) {
      if (!options?.restore) returning = null;
      return owner.apply(selection, options);
    },
    refresh: owner.refresh,
    effectiveWindow: owner.effectiveWindow,
    checkpoint() {
      const focusId = [...rows].find(([, record]) => record.row.contains(document.activeElement))?.[0] ?? null;
      return { paths: owner.checkpoint(), view: { position: position(), focusId, selectionKey, autoPaused,
        tableFocused: document.activeElement === scroll, timeline:{...owner.checkpointTimeline(),...timelineView.checkpoint()} } };
    },
    dispose() {
      owner.dispose();
      reserveSpace(false);
      timelineView.dispose();
      document.removeEventListener('visibilitychange', visibilityChanged);
      pollToggle.removeEventListener('click', togglePolling);
      listRetry.removeEventListener('click', retryList);
      previous.removeEventListener('click', previousPage);
      next.removeEventListener('click', nextPage);
      latest.removeEventListener('click', latestPage);
      refresh.removeEventListener('click', refreshPage);
      for (const [node, action] of cardActions) node.removeEventListener('click', action);
    },
  };
}
