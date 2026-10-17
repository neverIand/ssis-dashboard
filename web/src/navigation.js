import { ApiError } from './api.js';
import { formatId } from './display.js';
import { catalogName } from './selection.js';

export function readNavigation(response, kind, limit) {
  const invalid = () => { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); };
  const { data, meta } = response;
  if (!Array.isArray(data) || data.length > limit || meta?.limit !== limit
      || meta.sort !== 'name' || meta.direction !== 'asc' || meta.from !== null || meta.to !== null
      || typeof meta.has_more !== 'boolean'
      || (meta.has_more ? typeof meta.next_cursor !== 'string' || !meta.next_cursor || !data.length
        : meta.next_cursor !== null)) invalid();
  const ids = new Set();
  try {
    for (const row of data) {
      const id = row[kind === 'folders' ? 'folder_id' : 'project_id'];
      if (typeof id !== 'string' || ids.has(id)) invalid();
      formatId(id);
      ids.add(id);
      catalogName(row.name);
      if (row.description !== null && (typeof row.description !== 'string' || row.description.length > 1024)) invalid();
      if (kind === 'projects') {
        if (typeof row.folder_id !== 'string') invalid();
        formatId(row.folder_id);
        catalogName(row.folder_name);
      }
    }
  } catch { invalid(); }
  return data;
}

export function createNavigation({ api, kind, limit, publish, timeoutMs = 15000 }) {
  let folder = null;
  let entries = [null];
  let index = 0;
  let nextCursor = null;
  let failure = null;
  let active = null;
  let generation = 0;
  let disposed = false;

  function cancel() {
    generation += 1;
    if (active) {
      clearTimeout(active.timer);
      active.controller.abort();
    }
    active = null;
  }

  async function load(target) {
    if (disposed || active || (kind === 'projects' && folder === null)) return;
    const current = ++generation;
    const controller = new AbortController();
    let timedOut = false;
    const job = { controller, timer: setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) };
    active = job;
    index = target;
    nextCursor = null;
    failure = null;
    publish({ phase: 'loading', rows: [], page: index + 1, hasPrevious: false, hasNext: false });
    try {
      const response = await api.get(kind, { signal: controller.signal,
        params: { limit, sort: 'name', direction: 'asc', folder: kind === 'projects' ? folder : null,
          cursor: entries[target] } });
      if (disposed || current !== generation) return;
      if (controller.signal.aborted) throw new ApiError('timeout');
      const rows = readNavigation(response, kind, limit);
      nextCursor = response.meta.next_cursor;
      publish({ phase: 'ready', rows, page: index + 1, hasPrevious: index > 0, hasNext: nextCursor !== null });
    } catch (error) {
      if (disposed || current !== generation) return;
      failure = timedOut ? new ApiError('timeout')
        : error instanceof ApiError ? error : new ApiError('invalid_response');
      publish({ phase: 'error', rows: [], page: index + 1,
        hasPrevious: index > 0, hasNext: false, error: failure });
    } finally {
      clearTimeout(job.timer);
      if (current === generation) active = null;
    }
  }

  return {
    reset(nextFolder = null) {
      if (disposed) return;
      cancel();
      folder = nextFolder;
      entries = [null];
      index = 0;
      nextCursor = null;
      failure = null;
      if (kind === 'projects' && folder === null) {
        publish({ phase: 'idle', rows: [], page: 0, hasPrevious: false, hasNext: false });
        return;
      }
      return load(0);
    },
    next() {
      if (active || nextCursor === null) return;
      entries = [...entries.slice(0, index + 1), nextCursor];
      return load(index + 1);
    },
    previous() { if (!active && index > 0) return load(index - 1); },
    retry() {
      if (!failure || active) return;
      if (['invalid_cursor', 'cursor_expired'].includes(failure.code)) {
        entries = [null];
        return load(0);
      }
      return load(index);
    },
    clear() {
      cancel();
      entries = [null];
      index = 0;
      nextCursor = null;
      failure = null;
      publish({ phase: 'idle', rows: [], page: 0, hasPrevious: false, hasNext: false });
    },
    dispose() { disposed = true; cancel(); },
  };
}
