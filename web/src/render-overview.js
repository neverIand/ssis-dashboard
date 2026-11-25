import { createDisplay, errorLabel, formatCode, formatId, refreshStatus } from './display.js';
import { executionHref } from './detail-navigation.js';
import { createOverview } from './overview.js';
import { selectionParams, selectionSearch } from './selection.js';
import { mountTimeline } from './render-timeline.js';
import { reserveLoadingSpace } from './loading-space.js';
import { readRefreshPause, saveRefreshPause } from './refresh-pause.js';
import { breakableText, inlineStatus, pollingButton } from './ui.js';
import { mountTableViewport } from './table-viewport.js';

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
  const tipWindow = root.querySelector('[data-cohort-tip-window]');
  const previous = root.querySelector('[data-executions-previous]');
  const next = root.querySelector('[data-executions-next]');
  const latest = root.querySelector('[data-executions-latest]');
  let changeMark = 0;
  const pageNotice = root.querySelector('[data-page-notice]');
  const refresh = root.querySelector('[data-overview-refresh]');
  const pollToggle = root.querySelector('[data-poll-toggle]');
  const pollStatus = root.querySelector('[data-poll-status]');
  const scroll = table.parentElement;
  const reserveSpace = reserveLoadingSpace(scroll);
  const viewport = mountTableViewport(table, scroll, root.querySelector('.executions-toolbar'));
  const rows = new Map();
  const cards = Object.fromEntries(['total', 'running', 'succeeded', 'failed', 'other']
    .map((key) => [key, root.querySelector(`[data-count="${key}"]`)]));
  // Failed also counts status 6 (ended unexpectedly), which would otherwise hide under Other. Counts,
  // links and Other share these sets, so a code the server does not list stays under Other everywhere.
  const failedCodes = [4, 6].filter(code => metadata.execution_statuses.some(item => item.code === code));
  const carded = [2, 7, ...failedCodes];
  const statusSets = { total: [], running: [2], succeeded: [7], failed: failedCodes,
    other: metadata.execution_statuses.map(item => item.code).filter(code => !carded.includes(code)).sort((a,b) => a-b) };
  const cardLinks = Object.fromEntries(Object.keys(cards).map(key => [key, root.querySelector(`[data-status-card="${key}"]`)]));
  let appliedSelection = null, summaryAvailable = false;
  let renderedPage = null;
  let returning = restoreView;
  let selectionKey = null;
  let autoPaused = restoreView ? restoreView.autoPaused === true : readRefreshPause(window);
  let phase = 'idle';
  const timelineView=mountTimeline(root,{metadata,restoreView:restoreView?.timeline,
    actions:{toggle:()=>{void owner.toggleTimeline();},retry:()=>{void owner.retryTimeline();},
      bucket:value=>{void owner.setTimelineBucket(value);},
      // A bucket becomes an explicit custom Created range through the normal selection path.
      drill:range=>{if(!appliedSelection)return;
        const fromTimeline=root.querySelector('[data-timeline-panel]')?.contains(document.activeElement);
        onSelect({created:null,from:range.from,to:range.to});if(fromTimeline)scroll.focus({preventScroll:true});}}});

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

  function time(value, created = null) {
    if (value === null) return document.createTextNode('—');
    // Date and time wrap as whole parts in narrow columns, never inside the date.
    const node = element('time');
    // Started repeats Created's date almost always; show only its time then. The full value stays in title.
    const full = display.timestamp(value);
    const shown = created !== null && full.slice(0, 10) === display.timestamp(created).slice(0, 10) ? full.slice(11) : full;
    for (const [index, part] of shown.split(' ').entries()) {
      if (index) node.append(document.createTextNode(' '));
      node.append(element('span', part));
    }
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

  function renderRows(page, pageNumber, selection, refreshed = false) {
    if (!page.data.length) {
      empty(pageNumber > 1 ? 'No executions remain on this page. Use Previous or First page.'
        : 'No executions match these filters.');
      return;
    }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set();
    // On a refresh of the same page, briefly mark rows that are new or changed status.
    changeMark = 1 - changeMark;
    let cursor = body.firstChild;
    for (const item of page.data) {
      wanted.add(item.execution_id);
      let record = rows.get(item.execution_id);
      if (!record) {
        const row = element('tr');
        row.dataset.executionId = item.execution_id;
        const cells = ['id-cell', 'name-cell', 'name-cell package-cell', 'time-cell', 'time-cell', 'number-cell',
          'number-cell count-cell', 'number-cell count-cell', ''].map(className => element('td', undefined, className));
        const link = element('a', formatId(item.execution_id));
        link.dataset.executionLink = ''; link.dataset.executionId = item.execution_id;
        cells[0].append(link);
        const folder = element('a'), project = element('a', undefined, 'cell-detail');
        folder.dataset.selectionLink = ''; project.dataset.selectionLink = '';
        cells[1].append(folder, project);
        const packageLink = element('a');
        packageLink.dataset.executionLink = ''; packageLink.dataset.executionId = item.execution_id;
        // Same destination as the ID link, so one Tab stop per row is enough; pointer users keep it.
        packageLink.tabIndex = -1;
        cells[2].append(packageLink);
        cells[8].append(element('span', undefined, 'status-badge'));
        for (const index of [6, 7]) {
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
      const [id, folderProject, entryPackage, created, started, duration, warnings, errors, status] = cells;
      const changed = refreshed && (!previous || previous.status?.code !== item.status?.code);
      if (changed) row.dataset.changed = String(changeMark); else delete row.dataset.changed;
      const href = executionHref(item.execution_id, selection, { appBase, origin: window.location.origin, metadata });
      if (id.firstChild.getAttribute('href') !== href) id.firstChild.setAttribute('href', href);
      if (entryPackage.firstChild.getAttribute('href') !== href) entryPackage.firstChild.setAttribute('href', href);
      const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
      breakableText(folderProject.children[0], item.folder_name);
      breakableText(folderProject.children[1], item.project_name);
      breakableText(entryPackage.firstChild, item.package_name);
      linkSelection(folderProject.children[0], selection, { folder: item.folder_name, project: null });
      linkSelection(folderProject.children[1], selection, { folder: item.folder_name, project: item.project_name });
      text(status.firstChild, formatCode(item.status));
      row.dataset.status = status.firstChild.dataset.status = String(item.status?.code ?? '');
      for (const [cell, key] of [[created, 'created_at'], [started, 'started_at']]) {
        if (previous?.[key] !== item[key] || previous?.created_at !== item.created_at) {
          cell.replaceChildren(time(item[key], key === 'started_at' ? item.created_at : null));
        }
      }
      if (!previous || ['duration_seconds', 'elapsed_seconds', 'ended_at'].some((key) => previous[key] !== item[key])
          || JSON.stringify(previous.estimate) !== JSON.stringify(item.estimate)) {
        duration.replaceChildren(document.createTextNode(display.duration(item.duration_seconds)));
        if (item.ended_at === null && item.elapsed_seconds !== null) {
          // Elapsed beside the typical duration of earlier successful runs, never a percentage.
          // No-break spaces keep each part whole, so a narrow column wraps only between them.
          const estimate = item.estimate, whole = part => part.replaceAll(' ', '\u00a0');
          const detail = element('span', [`Elapsed: ${display.duration(item.elapsed_seconds)}`,
            ...(estimate ? [`typical ${display.duration(estimate.duration_seconds)}`] : [])].map(whole).join(' · '),
          'cell-detail');
          if (estimate) {
            detail.dataset.estimate = item.elapsed_seconds > estimate.duration_seconds ? 'over' : 'within';
            detail.title = `Typical: mean of ${display.count(estimate.sample_count)} earlier successful runs`
              + ` · expected end ${display.timestamp(estimate.ended_at)}`;
          }
          duration.append(detail);
        }
      }
      for (const [cell, kind, count] of [[warnings, 'warnings', item.warning_count], [errors, 'errors', item.error_count]]) {
        const link = cell.firstChild;
        text(link, display.count(count));
        const target = executionHref(item.execution_id, selection,
          { appBase, origin: window.location.origin, metadata,
            section: metadata.capabilities.events ? { tab: 'events', kind } : null });
        if (link.getAttribute('href') !== target) link.setAttribute('href', target);
        link.setAttribute('aria-label', `${display.count(count)} ${kind} for execution ${item.execution_id}`);
      }
      warnings.dataset.level = item.warning_count > 0 ? 'warning' : 'quiet';
      errors.dataset.level = item.error_count > 0 ? 'error' : 'quiet';
      record.item = item;
      if (row !== cursor) body.insertBefore(row, cursor);
      cursor = row.nextSibling;
    }
    for (const [id, record] of rows) {
      if (!wanted.has(id)) { record.row.remove(); rows.delete(id); }
    }
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
    refresh.setAttribute('data-refreshing', String(state.refreshing === true));
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
      if (page) renderRows(page, state.pageNumber, state.selection,
        state.operation === 'refresh' && !state.pageStale && renderedPage !== null);
      else empty(state.phase === 'loading-list' ? 'Loading executions…' : 'No data loaded.');
      renderedPage = page;
    } else if (page === null) {
      empty(state.phase === 'loading-list' ? 'Loading executions…'
        : state.phase === 'list-error' ? 'Executions could not be loaded.' : 'No data loaded.');
    }
    const pageDetails = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} rows` : '';
    const error = ['list-error', 'summary-error'].includes(state.phase) ? errorLabel(state.error) : '';
    const previousResults = error && state.pageStale ? 'Previous results shown.' : '';
    const previousCounts = state.summaryStale ? 'Previous counts shown.' : '';
    const pageTime = page ? display.timestamp(page.meta.generated_at) : '';
    const observed = pageTime ? `Observed ${pageTime}` : '';
    listStatus.title = [observed, error, previousCounts].filter(Boolean).join(' · ');
    listStatus.textContent = error
      ? [error, previousResults, previousCounts, pageDetails].filter(Boolean).join(' ')
      : state.pageStale ? pageDetails
      : state.phase === 'loading-list' ? 'Loading executions…' : pageDetails || 'No selection';
    const stale = state.pageStale || state.summaryStale;
    const observation = state.phase === 'summary-error' && state.summary ? state.summary : page;
    const [refreshText, refreshDetail] = refreshStatus(display, observation?.meta.generated_at, state.poll);
    const message = error ? [stale ? '⚠ Refresh failed'
      : `⚠ ${state.phase === 'summary-error' ? 'Summary' : 'Executions'} unavailable`, refreshText].filter(Boolean).join(' · ')
      : page ? refreshText : state.selection ? 'Loading executions…' : 'No selection';
    const countsTime = state.summaryStale && state.summary ? display.timestamp(state.summary.meta.generated_at) : '';
    inlineStatus(pollStatus, message, [refreshDetail, observed,
      countsTime && countsTime !== pageTime ? `Counts observed ${countsTime}` : '',
      error, previousResults, stale ? 'Previous counts shown.' : ''].filter(Boolean).join(' · '));
    tipWindow.textContent = page
      ? ` Window: ${display.timestamp(page.meta.from)} → ${display.timestamp(page.meta.to)} (end exclusive).` : '';
    const counts = state.summary ? Object.fromEntries(state.summary.data.by_status.map((item) => [item.code, item.count])) : null;
    const values = state.summary ? { total: state.summary.data.total, running: counts[2], succeeded: counts[7],
      failed: failedCodes.reduce((total, code) => total + (counts[code] ?? 0), 0),
      other: state.summary.data.by_status.filter(item => !carded.includes(item.code)).reduce((total,item) => total + item.count,
        0) } : null;
    // Counts carried through a reload stay visible but not actionable until the new counts arrive.
    summaryAvailable = values !== null && !(state.summaryStale && state.busy);
    for (const [key, node] of Object.entries(cards)) {
      // An unloaded count has visually hidden text; the stylesheet draws a decorative bar level with the dots.
      if (values) node.textContent = display.count(values[key]);
      else if (node.getAttribute('data-empty') !== 'true') node.replaceChildren(element('span', 'Not loaded', 'visually-hidden'));
      node.setAttribute('data-empty', String(!values));
      const link = cardLinks[key];
      const available = summaryAvailable && (key === 'total' || statusSets[key].length > 0);
      link.setAttribute('aria-disabled', String(!available));
      // Keep a disabled link focusable while its summary reloads. The click
      // guard above prevents activation until fresh counts are available.
      if (state.selection && (key === 'total' || statusSets[key].length)) linkSelection(link, state.selection, { status: statusSets[key] });
      else link.removeAttribute('href');
      if (state.selection && (key === 'total' || statusSets[key].length) &&
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
    // The Other card names its parts from the summary already loaded.
    const otherParts = state.summary ? state.summary.data.by_status.filter(item => !carded.includes(item.code) && item.count > 0)
      .map(item => `${formatCode(metadata.execution_statuses.find(status => status.code === item.code)
        ?? { code: item.code, name: 'unknown' })} ${display.count(item.count)}`) : [];
    cardLinks.other.title = (otherParts.length ? `Other: ${otherParts.join(', ')}. ` : '')
      + 'Filter selects ' + metadata.execution_statuses.filter(item =>
      statusSets.other.includes(item.code)).map(formatCode).join(', ')
      + (unknownCount ? `. Counts include ${display.count(unknownCount)} unknown codes, which the API cannot filter.` : '');
    if (values && otherParts.length) cardLinks.other.setAttribute('aria-label',
      `${display.count(values.other)} Other: ${otherParts.join(', ')}`);
    else cardLinks.other.removeAttribute('aria-label');
    timelineView.render(state.timeline,state.busy,state.selection,page);
    if (focused === listRetry && listRetry.hidden) refresh.focus({ preventScroll: true });
    if (rowFocus && document.activeElement !== focused) {
      (focused.isConnected ? focused : scroll).focus({ preventScroll: true });
    }
    if (currentPosition) restorePosition(currentPosition);
    const restoring = returning !== null;
    if (returning && !state.busy && state.selection !== null) {
      if (page) {
        if (returning.focusId !== null || returning.tableFocused) {
          (rows.get(returning.focusId)?.cells[0].firstChild ?? scroll).focus({ preventScroll: true });
        }
        restorePosition(returning.position);
      }
      returning = null;
    }
    viewport.update(page, { busy: state.busy, reveal: !state.pageStale && state.phase !== 'list-error' && !restoring });
  } });
  const retryList = () => { void owner.retryList(); };
  const pageAction = (control, action) => () => {
    if (!control.disabled && control.getAttribute('aria-disabled') !== 'true') viewport.pageChange();
    void action();
  };
  const previousPage = pageAction(previous, owner.previous);
  const nextPage = pageAction(next, owner.next);
  const latestPage = pageAction(latest, owner.latest);
  const refreshPage = () => { void (phase === 'summary-error' ? owner.retrySummary() : owner.refresh()); };
  const togglePolling = () => {
    owner.togglePolling();
    saveRefreshPause(window, autoPaused);
  };
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
      if (!options?.restore && selection && appliedSelection && selection.limit !== appliedSelection.limit) viewport.pageChange();
      else viewport.cancelPageChange();
      if (!options?.restore) returning = null;
      return owner.apply(selection, options);
    },
    refresh: owner.refresh,
    effectiveWindow: owner.effectiveWindow,
    get autoPaused() { return autoPaused; },
    checkpoint() {
      const focusId = [...rows].find(([, record]) => record.row.contains(document.activeElement))?.[0] ?? null;
      return { paths: owner.checkpoint(), view: { position: position(), focusId, selectionKey, autoPaused,
        tableFocused: document.activeElement === scroll, timeline:{...owner.checkpointTimeline(),...timelineView.checkpoint()} } };
    },
    dispose() {
      owner.dispose();
      reserveSpace(false);
      viewport.dispose();
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
