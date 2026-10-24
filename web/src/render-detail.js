import { createDisplay, refreshStatus } from './display.js';
import { createDetailLoader, detailFields } from './detail.js';
import { readOverviewReturn, readDetailFragment, detailFragment } from './detail-navigation.js';
import { mountDetailTabs } from './detail-tabs.js';
import { mountObservationTable } from './render-observations.js';
import { mountEvents } from './render-events.js';
import { mountParameters, mountOverrides } from './render-values.js';
import { mountHistory } from './render-history.js';
import { defaultSelection, selectionSearch } from './selection.js';

export function mountDetail(root, { api, metadata, executionId, appBase, restoreView = null }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const content = root.querySelector('[data-execution-detail]');
  const status = root.querySelector('[data-detail-status]');
  const retry = root.querySelector('[data-detail-retry]');
  const correlation = root.querySelector('[data-detail-request-id]');
  const elapsed = root.querySelector('[data-active-elapsed]');
  const refresh = root.querySelector('[data-detail-refresh]');
  const toggle = root.querySelector('[data-detail-poll-toggle]');
  const pollStatus = root.querySelector('[data-detail-poll-status]');
  const header = root.querySelector('[data-app-status]');
  const main = document.getElementById('main-content');
  const returnLink = root.querySelector('[data-overview-link]');
  const returnNotice = root.querySelector('[data-overview-return-notice]');
  const destination = readOverviewReturn(window.location.search,
    { appBase, origin: window.location.origin, metadata });
  returnLink.href = destination.href;
  returnLink.title = 'Return to overview filters at page one.';
  returnNotice.textContent = destination.notice;
  returnNotice.hidden = !destination.notice;
  const fields = [...root.querySelectorAll('[data-detail-field]')];
  const position = () => ({ x: window.scrollX, y: window.scrollY });
  const restorePosition = value => {
    if (window.scrollX !== value.x || window.scrollY !== value.y) window.scrollTo(value.x, value.y);
  };
  const focusTargets = { refresh, toggle, overview: returnLink, legacy: root.querySelector('[data-legacy-detail-link]'),
    executables: root.querySelector('[data-executables-toggle]'), children: root.querySelector('[data-children-toggle]'),
    events: root.querySelector('[data-events-toggle]'), parameters: root.querySelector('[data-parameters-toggle]'),
    overrides: root.querySelector('[data-overrides-toggle]'), history: root.querySelector('[data-history-toggle]'), retry, main };
  let returning = restoreView?.executionId === executionId ? restoreView : null;
  let autoPaused = returning?.autoPaused === true;
  const initialPosition = position(), initialFocus = document.activeElement;
  let rendered = null, activeTab = null;
  const tabView = mountDetailTabs(root, { metadata, revealInitial: !returning,
    select: target => { void loader.selectTab(target); } });
  const breadcrumb = Object.fromEntries(['folder', 'project', 'package'].map(key =>
    [key, root.querySelector(`[data-detail-breadcrumb="${key}"]`)]));
  const countLinks = [...root.querySelectorAll('[data-event-count-link]')];
  const countActions = countLinks.map(link => {
    const kind = link.dataset.eventCountLink;
    const click = event => {
      if ((event.button ?? 0) !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.getAttribute('href') !== null) tabView.follow({ tab: 'events', kind }, { focus: true });
    };
    link.addEventListener('click', click);
    return [link, click];
  });
  const executableView = mountObservationTable(root, { metadata, restoreView: returning?.executableView,
    actions: { toggle: () => { void loader.selectTab({ tab: 'executables' }); }, retry: () => { void loader.retryExecutables(); },
      order: query => { void loader.orderExecutables(query); }, previous: () => { void loader.previousExecutables(); },
      next: () => { void loader.nextExecutables(); }, latest: () => { void loader.latestExecutables(); } } });
  const childView = mountObservationTable(root, { metadata, resource: 'children', restoreView: returning?.childView,
    actions: { toggle: () => { void loader.selectTab({ tab: 'children' }); }, retry: () => { void loader.retryChildren(); },
      order: query => { void loader.orderChildren(query); }, previous: () => { void loader.previousChildren(); },
      next: () => { void loader.nextChildren(); }, latest: () => { void loader.latestChildren(); } } });
  const eventView = mountEvents(root, { metadata, restoreView: returning?.eventView,
    actions: { toggle: () => { void loader.selectTab({ tab: 'events' }); }, retry: () => { void loader.retryEvents(); },
      apply: query => { void loader.applyEvents(query); }, order: query => { void loader.orderEvents(query); },
      previous: () => { void loader.previousEvents(); }, next: () => { void loader.nextEvents(); },
      latest: () => { void loader.latestEvents(); } } });
  const parameterView = mountParameters(root, { metadata, restoreView: returning?.parameterView,
    actions: { toggle: () => { void loader.selectTab({ tab: 'parameters' }); }, retry: () => { void loader.retryParameters(); },
      order: query => { void loader.orderParameters(query); }, previous: () => { void loader.previousParameters(); },
      next: () => { void loader.nextParameters(); }, latest: () => { void loader.latestParameters(); } } });
  const overrideView = mountOverrides(root, { metadata, restoreView: returning?.overrideView,
    actions: { toggle: () => { void loader.selectTab({ tab: 'overrides' }); }, retry: () => { void loader.retryOverrides(); },
      order: query => { void loader.orderOverrides(query); }, previous: () => { void loader.previousOverrides(); },
      next: () => { void loader.nextOverrides(); }, latest: () => { void loader.latestOverrides(); } } });
  const historyView = mountHistory(root, { metadata, executionId, restoreView: returning?.historyView,
    navigation: {appBase, origin:window.location.origin, metadata, selection:destination.selection ?? defaultSelection(metadata)},
    actions: { toggle: () => { void loader.selectTab({ tab: 'history' }); }, retry: () => { void loader.retryHistory(); },
      order: query => { void loader.orderHistory(query); }, previous: () => { void loader.previousHistory(); },
      next: () => { void loader.nextHistory(); }, latest: () => { void loader.latestHistory(); } } });
  const clear = () => {
    content.hidden = true;
    elapsed.hidden = true;
    for (const node of Object.values(breadcrumb)) { node.textContent = '—'; node.removeAttribute('href'); }
    for (const field of fields) {
      field.textContent = '—';
      field.removeAttribute('datetime');
      field.removeAttribute('title');
      delete field.dataset.status;
      delete field.dataset.level;
    }
  };
  const loader = createDetailLoader({ api, metadata, executionId, autoRefresh: !autoPaused,
    initialTab: readDetailFragment(window.location.hash, metadata) ?? returning?.activeTab ?? {},
    restoreExecutables: returning?.executables, restoreChildren: returning?.children, restoreEvents: returning?.events,
    restoreParameters: returning?.parameters, restoreOverrides: returning?.overrides, restoreHistory: returning?.history,
    visible: document.visibilityState !== 'hidden', publish(state) {
    const currentPosition = rendered !== null ? position() : null;
    const focused = document.activeElement;
    const protectedFocus = content.contains(focused);
    content.setAttribute('aria-busy', String(state.busy));
    refresh.disabled = toggle.disabled = false;
    refresh.setAttribute('aria-disabled', String(state.busy));
    autoPaused = state.poll.paused;
    toggle.textContent = autoPaused ? 'Resume auto refresh' : 'Pause auto refresh';
    pollStatus.textContent = refreshStatus(display, state.response?.meta.generated_at, state.poll);
    pollStatus.title = state.response ? `Observed ${display.timestamp(state.response.meta.generated_at)} · ${state.response.meta.generated_at}` : '';
    retry.hidden = state.phase !== 'error' && !(state.busy && !retry.hidden);
    retry.disabled = false;
    retry.setAttribute('aria-disabled', String(state.busy));
    status.textContent = state.busy && state.operation === 'section' ? '' : state.busy ? (state.response ? 'Refreshing… Previous observation shown.' : 'Loading execution…')
      : state.phase === 'ready' ? '' : `${state.error.message}${state.stale ? ' Previous observation shown.' : ''}`;
    const sectionName = { executables: 'executable observations', children: 'package calls', events: 'events',
      parameters: 'parameters', overrides: 'overrides', history: 'package history' }[state.sectionBusy] ?? 'sections';
    header.textContent = state.busy && state.operation === 'section' ? `Loading ${sectionName}…`
      : state.busy ? (state.response ? 'Refreshing…' : 'Loading execution…')
      : state.phase === 'ready' ? '' : state.stale ? 'Refresh failed' : 'Execution unavailable';
    correlation.hidden = !state.error?.requestId;
    correlation.textContent = state.error?.requestId ? `Request ID: ${state.error.requestId}` : '';
    if (!state.response) clear();
    else if (state.response !== rendered) {
      const values = detailFields(state.response, display);
      const data = state.response.data;
      const selection = destination.selection ?? defaultSelection(metadata);
      breadcrumb.folder.textContent = data.folder_name;
      breadcrumb.project.textContent = data.project_name;
      breadcrumb.package.textContent = data.package_name;
      breadcrumb.folder.href = appBase + selectionSearch({ ...selection, folder: data.folder_name, project: null }, metadata);
      breadcrumb.project.href = appBase + selectionSearch({ ...selection, folder: data.folder_name, project: data.project_name }, metadata);
      for (const field of fields) {
        const key = field.dataset.detailField;
        if (field.textContent !== values[key]) field.textContent = values[key];
        const time = { created: data.created_at, started: data.started_at, ended: data.ended_at }[key];
        if (time) { field.setAttribute('datetime', time); field.setAttribute('title', time); }
        else { field.removeAttribute('datetime'); field.removeAttribute('title'); }
        if (key === 'status') field.dataset.status = data.status.name === 'unknown' ? 'unknown' : String(data.status.code);
        if (key === 'warnings' || key === 'errors') field.dataset.level =
          data.event_counts[key] === 0 ? 'quiet' : key === 'warnings' ? 'warning' : 'error';
      }
      elapsed.hidden = data.started_at === null || data.ended_at !== null;
      content.hidden = false;
    }
    rendered = state.response;
    executableView.render(state.executables, state.busy, state.response !== null, state.response?.data.started_at);
    childView.render(state.children, state.busy, state.response !== null, state.response?.data.started_at);
    eventView.render(state.events, state.busy, state.response !== null, state.response?.data.started_at);
    parameterView.render(state.parameters, state.busy, state.response !== null);
    overrideView.render(state.overrides, state.busy, state.response !== null);
    historyView.render(state.history, state.busy, state.response !== null, state.response?.data);
    for (const link of countLinks) {
      if (metadata.capabilities.events && state.response) link.href = detailFragment({ tab: 'events', kind: link.dataset.eventCountLink }, metadata);
      else link.removeAttribute('href');
      link.setAttribute('aria-label', `${link.textContent} ${link.dataset.eventCountLink === 'all'
        ? 'events' : link.dataset.eventCountLink.replaceAll('-', ' ')} for this execution`);
    }
    tabView.render(state);
    activeTab = state.activeTab ? { tab: state.activeTab,
      ...(state.activeTab === 'events' ? { kind: state.events.query.kind } : {}) } : null;
    if (focused === retry && retry.hidden) refresh.focus({ preventScroll: true });
    else if (content.hidden && protectedFocus) main.focus({ preventScroll: true });
    if (currentPosition) restorePosition(currentPosition);
    if (returning && !state.busy) {
      if (state.response) {
        if (document.activeElement === initialFocus && (!initialFocus || initialFocus === document.body
            || initialFocus === focusTargets[returning.focus])) {
          focusTargets[returning.focus]?.focus({ preventScroll: true });
        }
        const current = position();
        if (current.x === initialPosition.x && current.y === initialPosition.y) restorePosition(returning.position);
      }
      returning = null;
    }
    tabView.reveal();
  } });
  const load = () => { void loader.load(); };
  const togglePolling = () => loader.togglePolling();
  const visibilityChanged = () => loader.setVisible(document.visibilityState !== 'hidden');
  retry.addEventListener('click', load);
  refresh.addEventListener('click', load);
  toggle.addEventListener('click', togglePolling);
  document.addEventListener('visibilitychange', visibilityChanged);
  load();
  return { checkpoint() {
    return { executionId, autoPaused, activeTab, position: position(), executables: loader.checkpointExecutables(),
      executableView: executableView.checkpoint(), children: loader.checkpointChildren(), childView: childView.checkpoint(), events: loader.checkpointEvents(), eventView: eventView.checkpoint(),
      parameters: loader.checkpointParameters(), parameterView: parameterView.checkpoint(),
      overrides: loader.checkpointOverrides(), overrideView: overrideView.checkpoint(),
      history: loader.checkpointHistory(), historyView: historyView.checkpoint(),
      focus: Object.keys(focusTargets).find(key => focusTargets[key] === document.activeElement) ?? null };
  }, dispose() {
    loader.dispose();
    executableView.dispose();
    childView.dispose();
    eventView.dispose();
    parameterView.dispose();
    overrideView.dispose();
    historyView.dispose();
    tabView.dispose();
    for (const [link, click] of countActions) link.removeEventListener('click', click);
    retry.removeEventListener('click', load);
    refresh.removeEventListener('click', load);
    toggle.removeEventListener('click', togglePolling);
    document.removeEventListener('visibilitychange', visibilityChanged);
    refresh.disabled = toggle.disabled = true;
    retry.hidden = retry.disabled = true;
    pollStatus.textContent = '';
    pollStatus.title = '';
    status.textContent = 'Waiting for settings.';
    correlation.textContent = '';
    correlation.hidden = true;
    returning = rendered = null;
    clear();
  } };
}
