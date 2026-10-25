import { ApiError, safeRequestId } from './api.js';
import { createDisplay, formatCode, formatId, formatText } from './display.js';
import { createRefreshLoop } from './refresh-loop.js';
import { executableQuery, readExecutablePage } from './executables.js';
import { childQuery, readChildPage } from './children.js';
import { eventQuery, readEventPage } from './events.js';
import { parameterQuery, readParameterPage, overrideQuery, readOverridePage } from './values.js';
import { historyQuery, readHistoryPage, historyIdentity, sameHistoryIdentity, allHistoryStatuses } from './history.js';
import { defaultDetailTab, detailFragment, tabAllowed } from './detail-navigation.js';

export function readExecutionDetail(response, executionId, display) {
  try {
    const { data, meta } = response;
    if (!safeRequestId(meta.request_id) || meta.generated_at === null) throw new TypeError();
    display.timestamp(meta.generated_at);
    if (typeof data.execution_id !== 'string' || formatId(data.execution_id) !== executionId) throw new TypeError();
    const name = (value, width, nullable = false) => {
      if (value === null && nullable) return;
      if (typeof value !== 'string' || !value || value.length > width || value.includes('\0')
          || [...value].some(character => {
            const point = character.codePointAt(0);
            return point >= 0xd800 && point <= 0xdfff;
          })) throw new TypeError();
    };
    name(data.folder_name, 128);
    name(data.project_name, 128);
    name(data.package_name, 260);
    name(data.environment.folder_name, 128, true);
    name(data.environment.name, 128, true);
    if (data.project_lsn !== null && data.project_lsn !== '0') formatId(data.project_lsn);
    const code = value => {
      if (value === null || value.code < -2147483648 || value.code > 2147483647) throw new TypeError();
      formatCode(value);
    };
    code(data.status);
    if (data.logging_level !== null) code(data.logging_level);
    if (data.created_at === null) throw new TypeError();
    for (const field of ['created_at', 'started_at', 'ended_at']) display.timestamp(data[field]);
    display.duration(data.duration_seconds);
    display.duration(data.elapsed_seconds);
    if ((data.started_at === null && (data.duration_seconds !== null || data.elapsed_seconds !== null))
        || (data.ended_at === null && data.duration_seconds !== null)) throw new TypeError();
    for (const count of [data.warning_count, data.error_count, ...['all', 'warnings', 'errors',
      'duplicate_warnings', 'memory_warnings'].map(field => data.event_counts[field])]) {
      if (count === null) throw new TypeError();
      display.count(count);
    }
    const counts = data.event_counts;
    if (data.warning_count !== counts.warnings || data.error_count !== counts.errors
        || counts.duplicate_warnings > counts.warnings
        || BigInt(counts.errors) + BigInt(counts.warnings) + BigInt(counts.memory_warnings) > BigInt(counts.all)) {
      throw new TypeError();
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}

const transient = error => ['network', 'timeout'].includes(error.kind)
  || (error.kind === 'http' && (error.status >= 500 || [408, 429].includes(error.status)));

export function createDetailLoader({ api, executionId, metadata, publish, timeoutMs = 30000, locale,
  autoRefresh = true, visible = true, pollIntervalMs = 30000, maxPollIntervalMs = 300000,
  restoreExecutables = null, restoreChildren = null, restoreEvents = null, restoreParameters = null, restoreOverrides = null, restoreHistory = null,
  initialTab = null }) {
  if (executionId === null) throw new TypeError('Missing execution ID.');
  formatId(executionId);
  const display = createDisplay({ timeZone: metadata.display_timezone, locale });
  const definitions = {
    executables: { query: executableQuery, read: readExecutablePage, label: 'executable' },
    children: { query: childQuery, read: readChildPage, label: 'child' },
    events: { query: eventQuery, read: readEventPage, label: 'event' },
    parameters: { query: parameterQuery, read: readParameterPage, label: 'parameter', resource: 'values' },
    overrides: { query: overrideQuery, read: readOverridePage, label: 'override', resource: 'values' },
    history: { query: historyQuery, read: readHistoryPage, label: 'history', resource: 'history', global: true },
  };
  const keys = Object.keys(definitions);
  const emptyPath = () => ({ entries: [null], index: 0, cohort: null });
  const allowed = key => ['parameters', 'overrides'].includes(key) ? metadata.capabilities.values : key !== 'events' || metadata.capabilities.events;
  const initialSection = key => ({ open: false, query: ['parameters', 'overrides'].includes(key) ? { section: key, limit: metadata.limits.default_limit }
    : key === 'history' ? { status: allHistoryStatuses(metadata), sort: 'execution_id', direction: 'desc', limit: metadata.limits.default_limit }
    : { sort: key === 'events' ? 'message_time' : 'started_at', direction: 'asc',
      limit: metadata.limits.default_limit, ...(key === 'events' ? { kind: 'all', q: null } : {}) },
    phase: 'idle', page: null, error: null, stale: false, notice: '' });
  let paths = Object.fromEntries(keys.map(key => [key, emptyPath()]));
  const sections = Object.fromEntries(keys.map(key => {
    let section = initialSection(key);
    const saved = { executables: restoreExecutables, children: restoreChildren, events: restoreEvents,
      parameters: restoreParameters, overrides: restoreOverrides, history: restoreHistory }[key];
    if (saved?.open && allowed(key)) {
      try {
        section = { ...section, open: true, query: definitions[key].query(saved.query, metadata) };
        if (saved.path) paths[key] = { ...saved.path, entries: [...saved.path.entries] };
      } catch { section = initialSection(key); paths[key] = emptyPath(); }
    }
    return [key, section];
  }));
  let active = null, disposed = false, generation = 0, tabInitialized = false;
  let state = { phase: 'idle', executionId, response: null, error: null, stale: false,
    operation: 'initial', sectionBusy: null, activeTab: null, ...sections };
  const busy = () => state.phase === 'loading';
  const show = poll => publish({ ...state, busy: busy(), poll, ...Object.fromEntries(keys.map(key => [key, {
    ...state[key], pageNumber: paths[key].index + 1, hasPrevious: !busy() && paths[key].index > 0,
    hasNext: !busy() && Boolean(state[key].page?.meta.has_more),
  }])) });
  const loop = createRefreshLoop({ refresh: load, publish: show, paused: !autoRefresh, visible,
    intervalMs: pollIntervalMs, maxIntervalMs: maxPollIntervalMs });
  function emit(changes) {
    state = { ...state, ...changes };
    const errors = [state.error, ...keys.filter(key => state[key].open).map(key => state[key].error)].filter(Boolean);
    show(loop.update({ busy: busy(), eligible: true, failed: errors.length > 0,
      retryable: errors.every(transient), coversReturn: state.operation === 'initial' || state.operation === 'select' }));
  }
  const updateSection = (key, changes) => { state = { ...state, [key]: { ...state[key], ...changes } }; };
  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller?.abort(); }
    active = null;
  }
  async function request(job, resource, params) {
    const controller = new AbortController();
    job.controller = controller;
    let timedOut = false;
    job.timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await api.get(resource, { ...(params ? { params } : {}), signal: controller.signal });
      if (controller.signal.aborted) throw new ApiError('timeout');
      return response;
    } catch (error) {
      throw timedOut ? new ApiError('timeout') : error instanceof ApiError ? error : new ApiError('invalid_response');
    } finally { clearTimeout(job.timer); }
  }
  async function readSection(job, current, key, index, notice) {
    const query = state[key].query, path = paths[key], cursor = path.entries[index];
    updateSection(key, { phase: 'loading', error: null, notice });
    emit({ sectionBusy: key });
    try {
      const definition = definitions[key];
      const response = await request(job, definition.global ? definition.resource : `executions/${state.executionId}/${definition.resource ?? key}`,
        { ...query, ...(definition.global ? historyIdentity(state.response.data) : {}), ...(cursor === null ? {} : { cursor }) });
      if (disposed || current !== generation) return;
      const page = definition.read(response, state.executionId, query, metadata, display, state.response.data);
      if (cursor !== null && (page.meta.as_of !== path.cohort?.as_of || page.meta.upper_id !== path.cohort?.upper_id)) {
        throw new ApiError('invalid_response', { requestId: page.meta.request_id });
      }
      paths[key] = { index, entries: path.entries.slice(0, index + 1),
        cohort: { as_of: page.meta.as_of, upper_id: page.meta.upper_id } };
      if (page.meta.has_more) paths[key].entries.push(page.meta.next_cursor);
      updateSection(key, { page, phase: 'ready', error: null, stale: false, notice });
    } catch (error) {
      if (disposed || current !== generation) return;
      if (cursor !== null && ['invalid_cursor', 'cursor_expired'].includes(error.code)) {
        job.reset.add(key);
        paths[key] = emptyPath();
        updateSection(key, { page: null, stale: false });
        return readSection(job, current, key, 0, `The ${definitions[key].label} page link expired or is no longer valid. Reset to page one.`);
      }
      throw error;
    }
  }
  async function run({ base = true, only = null, index, keep = true, pending = [] } = {}) {
    if (disposed || active) return;
    const current = ++generation, previous = state.response;
    const job = { controller: null, timer: null, section: null, reset: new Set(),
      queue: new Set(only ? [only, ...pending] : base ? keys.filter(key => state[key].open) : pending) };
    active = job;
    emit({ phase: 'loading', error: null, stale: base && previous !== null,
      operation: base ? state.operation : 'section', sectionBusy: only });
    try {
      if (base) {
        const response = await request(job, `executions/${state.executionId}`);
        if (disposed || current !== generation) return;
        const detail = readExecutionDetail(response, state.executionId, display);
        if (initialTab !== null && !tabInitialized) {
          const target = defaultDetailTab(initialTab, detail.data.status, metadata);
          for (const key of keys) updateSection(key, { open: key === target.tab });
          if (target.tab === 'events' && target.kind !== state.events.query.kind) {
            paths.events = emptyPath();
            updateSection('events', { query: eventQuery({ ...state.events.query, kind: target.kind, q: null }, metadata) });
          }
          state = { ...state, activeTab: target.tab };
          tabInitialized = true;
          job.queue = new Set([target.tab]);
        }
        if (previous && !sameHistoryIdentity(previous.data, detail.data)) {
          paths.history = emptyPath();
          updateSection('history', { page: null, error: null, stale: false });
        }
        emit({ response: detail, stale: false });
      }
      while (job.queue.size && state.response) {
        const key = job.queue.values().next().value;
        job.queue.delete(key);
        if (!state[key].open) continue;
        job.section = key;
        const previousPage = key === only && !keep ? null : state[key].page;
        updateSection(key, { page: previousPage, stale: previousPage !== null, error: null });
        try { await readSection(job, current, key, key === only && index !== undefined ? index : paths[key].index, ''); }
        catch (error) {
          if (disposed || current !== generation) return;
          const failure = error instanceof ApiError ? error : new ApiError('invalid_response');
          if (failure.status === 404 && !definitions[key].global) throw failure;
          const retained = transient(failure) && !job.reset.has(key) ? previousPage : null;
          updateSection(key, { phase: 'error', error: failure, page: retained, stale: retained !== null });
        }
        if (disposed || current !== generation) return;
        job.section = null;
      }
      if (!disposed && current === generation) emit({ phase: 'ready', operation: 'refresh', sectionBusy: null });
    } catch (error) {
      if (!disposed && current === generation) {
        const failure = error instanceof ApiError ? error : new ApiError('invalid_response');
        const retained = previous !== null && transient(failure);
        for (const key of keys) {
          const page = retained ? state[key].page : null;
          if (!retained) paths[key] = emptyPath();
          updateSection(key, { page, phase: page ? 'error' : 'idle', error: retained ? failure : null, stale: page !== null });
        }
        emit({ phase: 'error', response: retained ? previous : null, error: failure, stale: retained,
          operation: 'refresh', sectionBusy: null });
      }
    } finally {
      clearTimeout(job.timer);
      if (active === job) active = null;
    }
  }
  function load() { return run(); }
  const sectionAction = (key, options = {}) => state.response && state[key].open
    ? run({ ...options, only: key, base: state.phase === 'error' || state.stale }) : undefined;
  function toggleSection(key) {
    if (disposed || !state.response || !allowed(key)) return;
    const open = !state[key].open;
    let pending = [];
    if (!open) {
      active?.queue.delete(key);
      if (active?.section === key) {
        pending = [...active.queue];
        cancel();
        state = { ...state, phase: 'ready', sectionBusy: null };
      }
    }
    updateSection(key, { open, page: null, error: null, stale: false, phase: open ? 'loading' : 'idle', notice: '' });
    if (!open) loop.reset();
    emit({});
    if (open) {
      if (active) active.queue.add(key);
      else return sectionAction(key, { keep: false });
    } else if (pending.length) return run({ base: false, pending });
  }
  function orderSection(key, changes) {
    if (disposed || active || !state.response || !state[key].open) return;
    const query = definitions[key].query({ ...state[key].query, ...changes }, metadata);
    paths[key] = emptyPath();
    updateSection(key, { query });
    return sectionAction(key, { index: 0, keep: false });
  }
  const next = key => !busy() && state[key].page?.meta.has_more
    ? sectionAction(key, { index: paths[key].index + 1, keep: false }) : undefined;
  const previous = key => !busy() && paths[key].index > 0
    ? sectionAction(key, { index: paths[key].index - 1, keep: false }) : undefined;
  function latest(key) {
    if (busy()) return;
    paths[key] = emptyPath();
    return sectionAction(key, { index: 0, keep: false });
  }
  function applyEvents(changes) {
    if (disposed || !allowed('events') || !state.response || !state.events.open) return;
    const query = eventQuery({ ...state.events.query, ...changes }, metadata);
    if (active && (active.section === 'events' || active.queue.has('events')) && paths.events.index === 0
        && Object.keys(query).every(key => query[key] === state.events.query[key])) return;
    const needsBase = state.phase === 'error' || state.stale;
    let pending = [];
    if (active?.section === 'events') {
      pending = [...active.queue]; cancel();
      state = { ...state, phase: 'ready', sectionBusy: null };
    }
    paths.events = emptyPath();
    updateSection('events', { query, page: null, error: null, stale: false, notice: '', phase: 'loading' });
    loop.reset(); emit({});
    if (active) { active.queue.add('events'); return; }
    return needsBase ? run() : run({ base: false, only: 'events', index: 0, keep: false, pending });
  }
  function selectTab(target) {
    if (disposed || !tabAllowed(target.tab, metadata)) return;
    detailFragment(target, metadata);
    if (target.tab === 'events' && target.kind !== undefined && !metadata.event_kinds.includes(target.kind)) return;
    if (!state.response) { initialTab = target; return; }
    const key = target.tab;
    if (state[key].open && state.activeTab === key) {
      return key === 'events' && target.kind !== undefined ? applyEvents({ kind: target.kind, q: null }) : undefined;
    }
    const needsBase = state.phase === 'error' || state.stale;
    if (active?.section) {
      cancel();
      state = { ...state, phase: 'ready', sectionBusy: null };
    }
    // Switching owns the entire visible section set. In-flight base work may finish;
    // obsolete section work is aborted and its generation can never publish again.
    for (const other of keys) updateSection(other, { open: other === key, page: null, error: null,
      stale: false, phase: other === key ? 'loading' : 'idle', notice: '' });
    if (key === 'events' && target.kind !== undefined) {
      paths.events = emptyPath();
      updateSection('events', { query: eventQuery({ ...state.events.query, kind: target.kind, q: null }, metadata) });
    }
    tabInitialized = true;
    state = { ...state, activeTab: key };
    loop.reset();
    if (active) { active.queue.clear(); active.queue.add(key); emit({}); return; }
    emit({});
    return needsBase ? run() : sectionAction(key, { keep: false });
  }
  const checkpoint = key => ({ open: state[key].open, query: { ...state[key].query },
    path: { ...paths[key], entries: [...paths[key].entries] } });
  const retry = key => state.phase === 'error' ? load() : sectionAction(key);
  return { load, refresh: load, selectTab,
    toggleHistory: () => toggleSection('history'), orderHistory: changes => orderSection('history', changes),
    nextHistory: () => next('history'), previousHistory: () => previous('history'), latestHistory: () => latest('history'),
    retryHistory: () => retry('history'), checkpointHistory: () => checkpoint('history'),
    toggleOverrides: () => toggleSection('overrides'), orderOverrides: changes => orderSection('overrides', changes),
    nextOverrides: () => next('overrides'), previousOverrides: () => previous('overrides'), latestOverrides: () => latest('overrides'),
    retryOverrides: () => retry('overrides'), checkpointOverrides: () => checkpoint('overrides'),
    toggleParameters: () => toggleSection('parameters'), orderParameters: changes => orderSection('parameters', changes),
    nextParameters: () => next('parameters'), previousParameters: () => previous('parameters'), latestParameters: () => latest('parameters'),
    retryParameters: () => retry('parameters'), checkpointParameters: () => checkpoint('parameters'),
    toggleEvents: () => toggleSection('events'), applyEvents, orderEvents: changes => orderSection('events', changes),
    nextEvents: () => next('events'), previousEvents: () => previous('events'), latestEvents: () => latest('events'),
    retryEvents: () => retry('events'), checkpointEvents: () => checkpoint('events'),
    toggleExecutables: () => toggleSection('executables'), toggleChildren: () => toggleSection('children'),
    orderExecutables: changes => orderSection('executables', changes), orderChildren: changes => orderSection('children', changes),
    nextExecutables: () => next('executables'), nextChildren: () => next('children'),
    previousExecutables: () => previous('executables'), previousChildren: () => previous('children'),
    latestExecutables: () => latest('executables'), latestChildren: () => latest('children'),
    retryExecutables: () => retry('executables'), retryChildren: () => retry('children'),
    checkpointExecutables: () => checkpoint('executables'), checkpointChildren: () => checkpoint('children'),
    select(id) {
      if (id === null) throw new TypeError('Missing execution ID.');
      formatId(id);
      if (disposed) return;
      if (id === state.executionId) return load();
      cancel(); loop.reset(); tabInitialized = false;
      paths = Object.fromEntries(keys.map(key => [key, emptyPath()]));
      state = { phase: 'idle', executionId: id, response: null, error: null, stale: false, operation: 'select', sectionBusy: null,
        ...Object.fromEntries(keys.map(key => [key, { ...initialSection(key), open: state[key].open }])) };
      return load();
    },
    setVisible: loop.setVisible,
    togglePolling: () => loop.togglePaused(),
    dispose() {
      disposed = true; loop.dispose(); cancel();
      paths = Object.fromEntries(keys.map(key => [key, emptyPath()]));
      state = { ...state, response: null, error: null, stale: false,
        ...Object.fromEntries(keys.map(key => [key, initialSection(key)])) };
    },
  };
}

export function detailFields(response, display) {
  const data = response.data;
  return {
    folder: formatText(data.folder_name), project: formatText(data.project_name),
    package: formatText(data.package_name), lsn: formatText(data.project_lsn),
    'environment-folder': formatText(data.environment.folder_name), environment: formatText(data.environment.name),
    status: formatCode(data.status), logging: formatCode(data.logging_level),
    created: display.timestamp(data.created_at), started: display.timestamp(data.started_at),
    ended: display.timestamp(data.ended_at), duration: display.duration(data.duration_seconds),
    elapsed: display.duration(data.elapsed_seconds),
    ...Object.fromEntries(Object.entries(data.event_counts).map(([field, count]) => [field, display.count(count)])),
  };
}
