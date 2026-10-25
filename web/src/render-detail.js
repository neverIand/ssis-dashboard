import { createDisplay, refreshStatus } from './display.js';
import { createDetailLoader, detailFields } from './detail.js';
import { readOverviewReturn, readDetailFragment, detailFragment } from './detail-navigation.js';
import { mountDetailTabs } from './detail-tabs.js';
import { mountObservationTable } from './render-observations.js';
import { mountEvents } from './render-events.js';
import { mountParameters, mountOverrides } from './render-values.js';
import { mountHistory } from './render-history.js';
import { defaultSelection, selectionSearch } from './selection.js';
import { inlineStatus, pollingButton } from './ui.js';

export function mountDetail(root, { api, metadata, executionId, appBase, restoreView = null }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const content = root.querySelector('[data-execution-detail]');
  const elapsed = root.querySelector('[data-active-elapsed]');
  const refresh = root.querySelector('[data-detail-refresh]');
  const toggle = root.querySelector('[data-detail-poll-toggle]');
  const pollStatus = root.querySelector('[data-detail-poll-status]');
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
  const title = fields.find(field => field.dataset.detailField === 'package');
  const badge = fields.find(field => field.dataset.detailField === 'status');
  const titleId = root.querySelector('[data-detail-id]');
  const position = () => ({ x: window.scrollX, y: window.scrollY });
  const restorePosition = value => {
    if (window.scrollX !== value.x || window.scrollY !== value.y) window.scrollTo(value.x, value.y);
  };
  const focusTargets = { refresh, toggle, overview: returnLink, legacy: root.querySelector('[data-legacy-detail-link]'),
    executables: root.querySelector('[data-executables-toggle]'), children: root.querySelector('[data-children-toggle]'),
    events: root.querySelector('[data-events-toggle]'), parameters: root.querySelector('[data-parameters-toggle]'),
    overrides: root.querySelector('[data-overrides-toggle]'), history: root.querySelector('[data-history-toggle]'), main };
  let returning = restoreView?.executionId === executionId ? restoreView : null;
  let autoPaused = returning?.autoPaused === true;
  const initialPosition = position(), initialFocus = document.activeElement;
  let rendered = null, activeTab = null;
  const tabView = mountDetailTabs(root, { metadata, revealInitial: !returning,
    select: target => { void loader.selectTab(target); } });
  const breadcrumb = Object.fromEntries(['folder', 'project'].map(key =>
    [key, root.querySelector(`[data-detail-breadcrumb="${key}"]`)]));
  const countLinks = [...root.querySelectorAll('[data-event-count-link]')];
  const countLabels = Object.fromEntries(['errors', 'warnings'].map(key =>
    [key, root.querySelector(`[data-event-count-label="${key}"]`)]));
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
  const actionsFor = key => ({
    toggle: () => { void loader.selectTab({ tab: key }); },
    retry: () => { void loader.section(key).retry(); },
    order: query => { void loader.section(key).order(query); },
    previous: () => { void loader.section(key).previous(); },
    next: () => { void loader.section(key).next(); },
    latest: () => { void loader.section(key).latest(); },
  });
  const executableView = mountObservationTable(root, { metadata, restoreView: returning?.executableView,
    actions: actionsFor('executables') });
  const childView = mountObservationTable(root, { metadata, resource: 'children', restoreView: returning?.childView,
    actions: actionsFor('children') });
  const eventView = mountEvents(root, { metadata, restoreView: returning?.eventView,
    actions: { ...actionsFor('events'), apply: query => { void loader.section('events').applyEvents(query); } } });
  const parameterView = mountParameters(root, { metadata, restoreView: returning?.parameterView,
    actions: actionsFor('parameters') });
  const overrideView = mountOverrides(root, { metadata, restoreView: returning?.overrideView,
    actions: actionsFor('overrides') });
  const historyView = mountHistory(root, { metadata, executionId, restoreView: returning?.historyView,
    navigation: { appBase, origin: window.location.origin, metadata, selection: destination.selection ?? defaultSelection(metadata) },
    actions: actionsFor('history') });
  const clear = () => {
    content.hidden = true;
    elapsed.hidden = true;
    for (const node of Object.values(breadcrumb)) {
      node.textContent = ''; node.removeAttribute('href'); node.parentElement.hidden = true;
    }
    for (const [key, label] of Object.entries(countLabels)) label.textContent = key;
    for (const field of fields) {
      field.textContent = '—';
      field.removeAttribute('datetime');
      field.removeAttribute('title');
      delete field.dataset.status;
      delete field.dataset.level;
    }
    // No placeholder dashes in the title: name the execution until its package is known.
    title.textContent = `Execution ${executionId}`;
    badge.textContent = '';
    badge.hidden = titleId.hidden = true;
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
    refresh.disabled = false;
    toggle.disabled = state.terminal;
    refresh.setAttribute('aria-disabled', String(state.busy));
    autoPaused = state.poll.paused;
    pollingButton(toggle, autoPaused, state.terminal);
    const observed = state.response
      ? `Observed ${display.timestamp(state.response.meta.generated_at)} · ${state.response.meta.generated_at}` : '';
    const error = state.error ? `${state.error.message}${state.error.requestId ? ` · Request ID: ${state.error.requestId}` : ''}` : '';
    const refreshText = refreshStatus(display, state.response?.meta.generated_at, state.poll, state.terminal);
    const pageStatus = state.busy && state.operation !== 'section'
      ? (state.response ? 'Refreshing… Previous observation shown.' : 'Loading execution…')
      : state.phase === 'error' ? (state.stale
        ? `⚠ Refresh failed · showing data from ${display.clock(state.response.meta.generated_at)}`
          : `⚠ Execution unavailable · ${state.error.message}`)
        : refreshText;
    inlineStatus(pollStatus, pageStatus, [observed, error,
      pageStatus !== refreshText ? refreshText : ''].filter(Boolean).join(' · '));
    if (!state.response) clear();
    else if (state.response !== rendered) {
      const values = detailFields(state.response, display);
      const data = state.response.data;
      if (data.environment.folder_name !== null) values.environment = `${data.environment.folder_name} / ${values.environment}`;
      const selection = destination.selection ?? defaultSelection(metadata);
      breadcrumb.folder.textContent = data.folder_name;
      breadcrumb.project.textContent = data.project_name;
      breadcrumb.folder.href = appBase + selectionSearch({ ...selection, folder: data.folder_name, project: null }, metadata);
      breadcrumb.project.href = appBase + selectionSearch({ ...selection, folder: data.folder_name, project: data.project_name }, metadata);
      for (const field of fields) {
        const key = field.dataset.detailField;
        if (field.textContent !== values[key]) field.textContent = values[key];
        const time = { created: data.created_at, started: data.started_at, ended: data.ended_at }[key];
        if (time) { field.setAttribute('datetime', time); field.setAttribute('title', time); }
        else { field.removeAttribute('datetime'); field.removeAttribute('title'); }
        if (key === 'status') field.dataset.status = data.status.name === 'unknown' ? 'unknown' : String(data.status.code);
        if (key in data.event_counts) field.dataset.level =
          data.event_counts[key] === 0 ? 'quiet' : key === 'errors' ? 'error' : key === 'all' ? 'normal' : 'warning';
      }
      for (const [key, label] of Object.entries(countLabels)) {
        label.textContent = data.event_counts[key] === 1 ? key.slice(0, -1) : key;
      }
      for (const node of Object.values(breadcrumb)) node.parentElement.hidden = false;
      badge.hidden = titleId.hidden = false;
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
      if (metadata.capabilities.events && state.response) link.href = detailFragment({ tab: 'events',
        kind: link.dataset.eventCountLink }, metadata);
      else link.removeAttribute('href');
      const kind = link.dataset.eventCountLink === 'all' ? 'events' : link.dataset.eventCountLink.replaceAll('-', ' ');
      const label = state.response?.data.event_counts[link.dataset.detailField] === 1 ? kind.slice(0, -1) : kind;
      link.setAttribute('aria-label', `${link.textContent} ${label} for this execution`);
    }
    tabView.render(state);
    activeTab = state.activeTab ? { tab: state.activeTab,
      ...(state.activeTab === 'events' ? { kind: state.events.query.kind } : {}) } : null;
    if (content.hidden && protectedFocus) main.focus({ preventScroll: true });
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
  refresh.addEventListener('click', load);
  toggle.addEventListener('click', togglePolling);
  document.addEventListener('visibilitychange', visibilityChanged);
  load();
  return { checkpoint() {
    return { executionId, autoPaused, activeTab, position: position(), executables: loader.section('executables').checkpoint(),
      executableView: executableView.checkpoint(),
      children: loader.section('children').checkpoint(), childView: childView.checkpoint(),
      events: loader.section('events').checkpoint(), eventView: eventView.checkpoint(),
      parameters: loader.section('parameters').checkpoint(), parameterView: parameterView.checkpoint(),
      overrides: loader.section('overrides').checkpoint(), overrideView: overrideView.checkpoint(),
      history: loader.section('history').checkpoint(), historyView: historyView.checkpoint(),
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
    refresh.removeEventListener('click', load);
    toggle.removeEventListener('click', togglePolling);
    document.removeEventListener('visibilitychange', visibilityChanged);
    refresh.disabled = toggle.disabled = true;
    pollStatus.textContent = '';
    pollStatus.title = '';
    returning = rendered = null;
    clear();
  } };
}
