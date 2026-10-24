import { createDisplay } from './display.js';
import { createDetailLoader, detailFields } from './detail.js';
import { readOverviewReturn } from './detail-navigation.js';
import { mountObservationTable } from './render-observations.js';
import { mountEvents } from './render-events.js';
import { mountParameters, mountOverrides } from './render-values.js';

export function mountDetail(root, { api, metadata, executionId, appBase, restoreView = null }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const content = root.querySelector('[data-execution-detail]');
  const status = root.querySelector('[data-detail-status]');
  const retry = root.querySelector('[data-detail-retry]');
  const correlation = root.querySelector('[data-detail-request-id]');
  const observed = root.querySelector('[data-detail-observed]');
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
  returnNotice.textContent = destination.notice;
  returnNotice.hidden = !destination.notice;
  const pollTime = new Intl.DateTimeFormat(undefined, { timeZone: metadata.display_timezone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  const fields = [...root.querySelectorAll('[data-detail-field]')];
  const position = () => ({ x: window.scrollX, y: window.scrollY });
  const restorePosition = value => {
    if (window.scrollX !== value.x || window.scrollY !== value.y) window.scrollTo(value.x, value.y);
  };
  const focusTargets = { refresh, toggle, overview: returnLink, legacy: root.querySelector('[data-legacy-detail-link]'),
    executables: root.querySelector('[data-executables-toggle]'), children: root.querySelector('[data-children-toggle]'),
    events: root.querySelector('[data-events-toggle]'), parameters: root.querySelector('[data-parameters-toggle]'),
    overrides: root.querySelector('[data-overrides-toggle]'), retry, main };
  let returning = restoreView?.executionId === executionId ? restoreView : null;
  let autoPaused = returning?.autoPaused === true;
  const initialPosition = position(), initialFocus = document.activeElement;
  let rendered = null;
  const executableView = mountObservationTable(root, { metadata, restoreView: returning?.executableView,
    actions: { toggle: () => { void loader.toggleExecutables(); }, retry: () => { void loader.retryExecutables(); },
      order: query => { void loader.orderExecutables(query); }, previous: () => { void loader.previousExecutables(); },
      next: () => { void loader.nextExecutables(); }, latest: () => { void loader.latestExecutables(); } } });
  const childView = mountObservationTable(root, { metadata, resource: 'children', restoreView: returning?.childView,
    actions: { toggle: () => { void loader.toggleChildren(); }, retry: () => { void loader.retryChildren(); },
      order: query => { void loader.orderChildren(query); }, previous: () => { void loader.previousChildren(); },
      next: () => { void loader.nextChildren(); }, latest: () => { void loader.latestChildren(); } } });
  const eventView = mountEvents(root, { metadata, restoreView: returning?.eventView,
    actions: { toggle: () => { void loader.toggleEvents(); }, retry: () => { void loader.retryEvents(); },
      apply: query => { void loader.applyEvents(query); }, order: query => { void loader.orderEvents(query); },
      previous: () => { void loader.previousEvents(); }, next: () => { void loader.nextEvents(); },
      latest: () => { void loader.latestEvents(); } } });
  const parameterView = mountParameters(root, { metadata, restoreView: returning?.parameterView,
    actions: { toggle: () => { void loader.toggleParameters(); }, retry: () => { void loader.retryParameters(); },
      order: query => { void loader.orderParameters(query); }, previous: () => { void loader.previousParameters(); },
      next: () => { void loader.nextParameters(); }, latest: () => { void loader.latestParameters(); } } });
  const overrideView = mountOverrides(root, { metadata, restoreView: returning?.overrideView,
    actions: { toggle: () => { void loader.toggleOverrides(); }, retry: () => { void loader.retryOverrides(); },
      order: query => { void loader.orderOverrides(query); }, previous: () => { void loader.previousOverrides(); },
      next: () => { void loader.nextOverrides(); }, latest: () => { void loader.latestOverrides(); } } });
  const clear = () => {
    content.hidden = true;
    elapsed.hidden = true;
    observed.textContent = '';
    for (const field of fields) {
      field.textContent = '—';
      field.removeAttribute('datetime');
      field.removeAttribute('title');
      delete field.dataset.status;
      delete field.dataset.level;
    }
  };
  const loader = createDetailLoader({ api, metadata, executionId, autoRefresh: !autoPaused,
    restoreExecutables: returning?.executables, restoreChildren: returning?.children, restoreEvents: returning?.events,
    restoreParameters: returning?.parameters, restoreOverrides: returning?.overrides,
    visible: document.visibilityState !== 'hidden', publish(state) {
    const currentPosition = rendered !== null ? position() : null;
    const focused = document.activeElement;
    const protectedFocus = content.contains(focused);
    content.setAttribute('aria-busy', String(state.busy));
    refresh.disabled = toggle.disabled = false;
    refresh.setAttribute('aria-disabled', String(state.busy));
    autoPaused = state.poll.paused;
    toggle.textContent = autoPaused ? 'Resume auto refresh' : 'Pause auto refresh';
    pollStatus.textContent = state.poll.mode === 'scheduled'
      ? `${state.poll.failures ? 'Retry' : 'Next refresh'}: ${pollTime.format(state.poll.nextAt)}.`
      : ({ idle: '', paused: 'Auto refresh paused.', hidden: 'Auto refresh paused while this tab is hidden.',
        updating: 'Auto refresh on.', blocked: 'Auto refresh stopped. Retry when the cause is resolved.' })[state.poll.mode];
    retry.hidden = state.phase !== 'error' && !(state.busy && !retry.hidden);
    retry.disabled = false;
    retry.setAttribute('aria-disabled', String(state.busy));
    status.textContent = state.busy && state.operation === 'section' ? '' : state.busy ? (state.response ? 'Refreshing… Previous observation shown.' : 'Loading execution…')
      : state.phase === 'ready' ? '' : `${state.error.message}${state.stale ? ' Previous observation shown.' : ''}`;
    const sectionName = { executables: 'executable observations', children: 'package calls', events: 'events',
      parameters: 'parameters', overrides: 'overrides' }[state.sectionBusy] ?? 'sections';
    header.textContent = state.busy && state.operation === 'section' ? `Loading ${sectionName}…`
      : state.busy ? (state.response ? 'Refreshing…' : 'Loading execution…')
      : state.phase === 'ready' ? 'Loaded' : state.stale ? 'Refresh failed' : 'Execution unavailable';
    correlation.hidden = !state.error?.requestId;
    correlation.textContent = state.error?.requestId ? `Request ID: ${state.error.requestId}` : '';
    if (!state.response) clear();
    else if (state.response !== rendered) {
      const values = detailFields(state.response, display);
      const data = state.response.data;
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
      observed.textContent = `Observed ${display.timestamp(state.response.meta.generated_at)}`;
      content.hidden = false;
    }
    rendered = state.response;
    executableView.render(state.executables, state.busy, state.response !== null);
    childView.render(state.children, state.busy, state.response !== null);
    eventView.render(state.events, state.busy, state.response !== null);
    parameterView.render(state.parameters, state.busy, state.response !== null);
    overrideView.render(state.overrides, state.busy, state.response !== null);
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
    return { executionId, autoPaused, position: position(), executables: loader.checkpointExecutables(),
      executableView: executableView.checkpoint(), children: loader.checkpointChildren(), childView: childView.checkpoint(), events: loader.checkpointEvents(), eventView: eventView.checkpoint(),
      parameters: loader.checkpointParameters(), parameterView: parameterView.checkpoint(),
      overrides: loader.checkpointOverrides(), overrideView: overrideView.checkpoint(),
      focus: Object.keys(focusTargets).find(key => focusTargets[key] === document.activeElement) ?? null };
  }, dispose() {
    loader.dispose();
    executableView.dispose();
    childView.dispose();
    eventView.dispose();
    parameterView.dispose();
    overrideView.dispose();
    retry.removeEventListener('click', load);
    refresh.removeEventListener('click', load);
    toggle.removeEventListener('click', togglePolling);
    document.removeEventListener('visibilitychange', visibilityChanged);
    refresh.disabled = toggle.disabled = true;
    retry.hidden = retry.disabled = true;
    pollStatus.textContent = '';
    status.textContent = 'Waiting for settings.';
    correlation.textContent = '';
    correlation.hidden = true;
    returning = rendered = null;
    clear();
  } };
}
