import { ApiError, createApi } from './api.js';
import { createDisplay } from './display.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readMetadata(data, requestId = null) {
  const invalid = () => { throw new ApiError('invalid_metadata', { requestId }); };
  if (!record(data) || data.api_version !== 'v1' || !record(data.limits) || !record(data.capabilities)) invalid();
  const limits = data.limits;
  for (const name of ['default_limit', 'max_limit', 'default_range_hours', 'max_range_hours', 'max_cursor_characters']) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) invalid();
  }
  if (limits.default_limit > limits.max_limit || limits.default_range_hours > limits.max_range_hours) invalid();
  for (const name of ['events', 'values', 'override_values']) {
    if (typeof data.capabilities[name] !== 'boolean') invalid();
  }
  if (data.capabilities.override_values && !data.capabilities.values) invalid();
  if (!Array.isArray(data.execution_statuses) || !data.execution_statuses.length
      || !Array.isArray(data.execution_sorts) || !data.execution_sorts.length) invalid();
  const codes = new Set();
  for (const status of data.execution_statuses) {
    if (!Number.isSafeInteger(status?.code) || status.code < 1 || typeof status.name !== 'string'
        || !status.name || codes.has(status.code)) invalid();
    codes.add(status.code);
  }
  if (data.execution_sorts.some((name) => typeof name !== 'string' || !name)
      || new Set(data.execution_sorts).size !== data.execution_sorts.length) invalid();
  if (!Array.isArray(data.executable_results) || !data.executable_results.length) invalid();
  const results = new Set();
  for (const result of data.executable_results) {
    if (!Number.isSafeInteger(result?.code) || result.code < -32768 || result.code > 32767
        || !['success', 'failure', 'completion', 'cancelled', 'unknown'].includes(result.name)
        || results.has(result.code)) invalid();
    results.add(result.code);
  }
  try {
    createDisplay({ timeZone: data.display_timezone });
  } catch {
    invalid();
  }
  return data;
}

export function createMetadataLoader({ request, publish, timeoutMs = 10000 }) {
  let active = null;
  let disposed = false;
  let generation = 0;

  async function load() {
    if (disposed || active) return;
    const controller = new AbortController();
    const current = ++generation;
    const job = { controller, timeout: null };
    active = job;
    let timedOut = false;
    job.timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    publish({ phase: 'loading', metadata: null });
    try {
      const response = await request({ signal: controller.signal });
      if (disposed || current !== generation) return;
      if (controller.signal.aborted) throw new ApiError('timeout');
      const metadata = readMetadata(response.data, response.meta.request_id);
      publish({ phase: 'ready', metadata });
    } catch (error) {
      if (disposed || current !== generation) return;
      const failure = timedOut ? new ApiError('timeout')
        : error instanceof ApiError ? error : new ApiError('invalid_metadata');
      publish({ phase: 'error', metadata: null, error: failure });
    } finally {
      clearTimeout(job.timeout);
      if (current === generation) active = null;
    }
  }

  return {
    load,
    dispose() {
      disposed = true;
      generation += 1;
      if (active) {
        clearTimeout(active.timeout);
        active.controller.abort();
      }
      active = null;
    },
  };
}

export function mountBootstrap(root, { ready = () => {} } = {}) {
  const document = root.ownerDocument;
  const status = root.querySelector('[data-app-status]');
  const retry = root.querySelector('[data-retry]');
  const correlation = root.querySelector('[data-request-id]');
  const timezone = root.querySelector('[data-display-timezone]');
  const config = JSON.parse(document.getElementById('app-config').textContent);
  const api = createApi(config.api_base, { origin: document.location.origin });
  let disposeScreen;
  const loader = createMetadataLoader({
    request: (options) => api.get('meta', options),
    publish(state) {
      root.dataset.startup = state.phase;
      status.textContent = state.phase === 'loading' ? 'Loading settings…'
        : state.phase === 'ready' ? 'Ready' : state.error.message;
      retry.hidden = state.phase !== 'error';
      retry.disabled = state.phase === 'loading';
      correlation.hidden = state.phase !== 'error' || !state.error.requestId;
      correlation.textContent = state.error?.requestId ? `Request ID: ${state.error.requestId}` : '';
      timezone.hidden = state.phase !== 'ready';
      if (state.phase === 'ready') {
        const metadata = state.metadata;
        timezone.textContent = metadata.display_timezone;
        timezone.setAttribute('aria-label', `Display timezone: ${metadata.display_timezone}`);
        disposeScreen?.();
        disposeScreen = ready(metadata, api, config);
      }
    },
  });
  const reload = () => { void loader.load(); };
  retry.addEventListener('click', reload);
  void loader.load();
  return () => {
    loader.dispose();
    disposeScreen?.();
    retry.removeEventListener('click', reload);
  };
}
