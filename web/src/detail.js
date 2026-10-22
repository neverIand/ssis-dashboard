import { ApiError, safeRequestId } from './api.js';
import { createDisplay, formatCode, formatId, formatText } from './display.js';
import { createRefreshLoop } from './refresh-loop.js';
import { executableQuery, readExecutablePage } from './executables.js';

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
  restoreExecutables = null }) {
  if (executionId === null) throw new TypeError('Missing execution ID.');
  formatId(executionId);
  const display = createDisplay({ timeZone: metadata.display_timezone, locale });
  let active = null;
  let disposed = false;
  let generation = 0;
  const emptyPath = () => ({ entries: [null], index: 0, cohort: null });
  const initialSection = () => ({ open: false, query: { sort: 'started_at', direction: 'asc', limit: metadata.limits.default_limit },
    phase: 'idle', page: null, error: null, stale: false, notice: '' });
  let path = emptyPath();
  let section = initialSection();
  if (restoreExecutables?.open) {
    try {
      section = { ...section, open: true, query: executableQuery(restoreExecutables.query, metadata) };
      if (restoreExecutables.path) path = { ...restoreExecutables.path, entries: [...restoreExecutables.path.entries] };
    } catch { section = initialSection(); }
  }
  let state = { phase: 'idle', executionId, response: null, error: null, stale: false,
    operation: 'initial', executables: section };
  const busy = () => state.phase === 'loading';
  const show = poll => publish({ ...state, busy: busy(), poll, executables: { ...state.executables,
    pageNumber: path.index + 1, hasPrevious: !busy() && path.index > 0,
    hasNext: !busy() && Boolean(state.executables.page?.meta.has_more) } });
  const loop = createRefreshLoop({ refresh: load, publish: show, paused: !autoRefresh, visible,
    intervalMs: pollIntervalMs, maxIntervalMs: maxPollIntervalMs });
  function emit(changes) {
    state = { ...state, ...changes };
    const error = state.error ?? (state.executables.open ? state.executables.error : null);
    show(loop.update({ busy: busy(), eligible: true, failed: error !== null,
      retryable: error === null || transient(error),
      coversReturn: state.operation === 'initial' || state.operation === 'select' }));
  }
  const updateSection = changes => { state = { ...state, executables: { ...state.executables, ...changes } }; };
  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller?.abort(); }
    active = null;
  }
  async function request(job, resource, params) {
    const controller = new AbortController();
    job.controller = controller;
    job.resource = resource;
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
  async function readSection(job, current, index, notice) {
    const query = state.executables.query;
    const cursor = path.entries[index];
    updateSection({ phase: 'loading', error: null, notice });
    emit({});
    try {
      const response = await request(job, `executions/${state.executionId}/executables`,
        { ...query, ...(cursor === null ? {} : { cursor }) });
      if (disposed || current !== generation) return;
      const page = readExecutablePage(response, state.executionId, query, metadata, display);
      if (cursor !== null && (page.meta.as_of !== path.cohort?.as_of || page.meta.upper_id !== path.cohort?.upper_id)) {
        throw new ApiError('invalid_response', { requestId: page.meta.request_id });
      }
      path = { index, entries: path.entries.slice(0, index + 1),
        cohort: { as_of: page.meta.as_of, upper_id: page.meta.upper_id } };
      if (page.meta.has_more) path.entries.push(page.meta.next_cursor);
      updateSection({ page, phase: 'ready', error: null, stale: false, notice });
    } catch (error) {
      if (disposed || current !== generation) return;
      if (cursor !== null && ['invalid_cursor', 'cursor_expired'].includes(error.code)) {
        job.sectionReset = true;
        path = emptyPath();
        updateSection({ page: null, stale: false });
        return readSection(job, current, 0, 'The executable page link expired or is no longer valid. Reset to page one.');
      }
      throw error;
    }
  }
  async function run({ base = true, index = path.index, keep = true, notice = '' } = {}) {
    if (disposed || active) return;
    const current = ++generation;
    const previous = state.response;
    const previousPage = keep ? state.executables.page : null;
    const job = { controller: null, timer: null, resource: null };
    active = job;
    updateSection({ page: previousPage, stale: previousPage !== null, error: null, notice });
    emit({ phase: 'loading', response: previous, error: null, stale: base && previous !== null,
      operation: base ? state.operation : 'section' });
    try {
      if (base) {
        const response = await request(job, `executions/${state.executionId}`);
        if (disposed || current !== generation) return;
        emit({ response: readExecutionDetail(response, state.executionId, display), stale: false });
      }
      if (state.executables.open && state.response) await readSection(job, current, index, notice);
      if (!disposed && current === generation) emit({ phase: 'ready', operation: 'refresh' });
    } catch (error) {
      if (!disposed && current === generation) {
        const failure = error instanceof ApiError ? error : new ApiError('invalid_response');
        if (job.resource?.endsWith('/executables') && failure.status !== 404) {
          const retained = transient(failure) && !job.sectionReset ? previousPage : null;
          updateSection({ phase: 'error', error: failure, page: retained, stale: retained !== null });
          emit({ phase: 'ready', stale: false, operation: 'refresh' });
        } else {
          const retained = previous !== null && transient(failure);
          if (!retained) path = emptyPath();
          updateSection({ phase: retained && previousPage ? 'error' : 'idle', error: retained ? failure : null,
            page: retained ? previousPage : null, stale: retained && previousPage !== null });
          emit({ phase: 'error', response: retained ? previous : null, error: failure, stale: retained, operation: 'refresh' });
        }
      }
    } finally {
      clearTimeout(job.timer);
      if (active === job) active = null;
    }
  }
  function load() { return run(); }
  const sectionAction = options => state.response && state.executables.open
    ? run({ ...options, base: options.base || state.phase === 'error' || state.stale }) : undefined;
  return { load, refresh: load,
    toggleExecutables() {
      if (disposed || !state.response) return;
      const open = !state.executables.open;
      if (!open && active?.resource?.endsWith('/executables')) {
        cancel();
        state = { ...state, phase: 'ready' };
      }
      updateSection({ open, page: null, error: null, stale: false, phase: 'idle', notice: '' });
      if (!open) loop.reset();
      emit({});
      if (open) return sectionAction({ base: false, keep: false });
    },
    orderExecutables(changes) {
      if (disposed || active || !state.response || !state.executables.open) return;
      const query = executableQuery({ ...state.executables.query, ...changes }, metadata);
      path = emptyPath();
      updateSection({ query });
      return sectionAction({ base: false, index: 0, keep: false });
    },
    nextExecutables() {
      if (!busy() && state.executables.page?.meta.has_more) return sectionAction({ base: false, index: path.index + 1, keep: false });
    },
    previousExecutables() {
      if (!busy() && path.index > 0) return sectionAction({ base: false, index: path.index - 1, keep: false });
    },
    latestExecutables() {
      if (busy()) return;
      path = emptyPath();
      return sectionAction({ base: false, index: 0, keep: false });
    },
    retryExecutables() { return state.phase === 'error' ? load() : sectionAction({ base: false }); },
    checkpointExecutables() {
      return { open: state.executables.open, query: { ...state.executables.query },
        path: { ...path, entries: [...path.entries] } };
    },
    select(id) {
      if (id === null) throw new TypeError('Missing execution ID.');
      formatId(id);
      if (disposed) return;
      if (id === state.executionId) return load();
      cancel();
      loop.reset();
      path = emptyPath();
      state = { phase: 'idle', executionId: id, response: null, error: null, stale: false, operation: 'select',
        executables: { ...initialSection(), open: state.executables.open } };
      return load();
    },
    setVisible: loop.setVisible,
    togglePolling: () => loop.togglePaused(),
    dispose() {
      disposed = true;
      loop.dispose();
      cancel();
      path = emptyPath();
      state = { ...state, response: null, error: null, stale: false, executables: initialSection() };
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
