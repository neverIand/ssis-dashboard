import { ApiError, safeRequestId } from './api.js';
import { createDisplay, formatCode, formatId, formatText } from './display.js';
import { createRefreshLoop } from './refresh-loop.js';

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
  autoRefresh = true, visible = true, pollIntervalMs = 30000, maxPollIntervalMs = 300000 }) {
  if (executionId === null) throw new TypeError('Missing execution ID.');
  formatId(executionId);
  const display = createDisplay({ timeZone: metadata.display_timezone, locale });
  let active = null;
  let disposed = false;
  let generation = 0;
  let state = { phase: 'idle', executionId, response: null, error: null, stale: false, operation: 'initial' };
  const busy = () => state.phase === 'loading';
  const show = poll => publish({ ...state, busy: busy(), poll });
  const loop = createRefreshLoop({ refresh: load, publish: show, paused: !autoRefresh, visible,
    intervalMs: pollIntervalMs, maxIntervalMs: maxPollIntervalMs });
  function emit(changes) {
    state = { ...state, ...changes };
    show(loop.update({ busy: busy(), eligible: true, failed: state.phase === 'error',
      retryable: state.error === null || transient(state.error),
      coversReturn: state.operation === 'initial' || state.operation === 'select' }));
  }
  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller.abort(); }
    active = null;
  }
  async function load() {
    if (disposed || active) return;
    const current = ++generation;
    const id = state.executionId;
    const previous = state.response;
    const controller = new AbortController();
    const job = { controller, timer: null };
    active = job;
    let timedOut = false;
    job.timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    emit({ phase: 'loading', response: previous, error: null, stale: previous !== null });
    try {
      const response = await api.get(`executions/${id}`, { signal: controller.signal });
      if (disposed || current !== generation) return;
      if (controller.signal.aborted) throw new ApiError('timeout');
      emit({ phase: 'ready', response: readExecutionDetail(response, id, display), error: null,
        stale: false, operation: 'refresh' });
    } catch (error) {
      if (!disposed && current === generation) {
        const failure = timedOut ? new ApiError('timeout')
          : error instanceof ApiError ? error : new ApiError('invalid_response');
        const keep = previous !== null && transient(failure);
        emit({ phase: 'error', response: keep ? previous : null, error: failure, stale: keep, operation: 'refresh' });
      }
    } finally {
      clearTimeout(job.timer);
      if (active === job) active = null;
    }
  }
  return { load, refresh: load,
    select(id) {
      if (id === null) throw new TypeError('Missing execution ID.');
      formatId(id);
      if (disposed) return;
      if (id === state.executionId) return load();
      cancel();
      loop.reset();
      state = { phase: 'idle', executionId: id, response: null, error: null, stale: false, operation: 'select' };
      return load();
    },
    setVisible: loop.setVisible,
    togglePolling: () => loop.togglePaused(),
    dispose() {
      disposed = true;
      loop.dispose();
      cancel();
      state = { ...state, response: null, error: null, stale: false };
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
