import { ApiError } from './api.js';
import { readNavigation } from './navigation.js';

// Search the accessible catalog through the existing bounded API. Never call a
// loaded-page-only filter a catalog search, or publish late results after a switch.
export function createCatalogSearch({ api, kind, limit, publish, timeoutMs = 15000, pageBudget = 20 }) {
  let generation = 0, active = null, disposed = false;
  let folder = null, term = '', cursor = null, rows = [], complete = false, failure = null;
  let seenCursors = new Set();
  const emit = phase => publish({ phase, rows: [...rows], complete, error: failure });
  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller.abort(); }
    active = null;
  }
  async function more() {
    if (disposed || active || complete || (kind === 'projects' && folder === null)) return;
    const current = ++generation, controller = new AbortController();
    const job = { controller, timer: null };
    active = job;
    failure = null;
    emit('loading');
    try {
      const target = rows.length + limit;
      for (let page = 0; page < pageBudget; page += 1) {
        let timedOut = false;
        job.timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        let response;
        try {
          response = await api.get(kind, { signal: controller.signal,
            params: { limit, sort: 'name', direction: 'asc', folder: kind === 'projects' ? folder : null, cursor } });
        } catch (error) { throw timedOut ? new ApiError('timeout') : error; }
        finally { clearTimeout(job.timer); }
        if (disposed || current !== generation) return;
        if (controller.signal.aborted) throw new ApiError('timeout');
        const pageRows = readNavigation(response, kind, limit);
        const next = response.meta.next_cursor;
        if (next !== null && seenCursors.has(next)) throw new ApiError('invalid_response');
        if (next !== null) seenCursors.add(next);
        const ids = new Set(rows.map(row => row[kind === 'folders' ? 'folder_id' : 'project_id']));
        rows.push(...pageRows.filter(row => row.name.toLocaleLowerCase().includes(term)
          && !ids.has(row[kind === 'folders' ? 'folder_id' : 'project_id'])));
        cursor = next;
        complete = next === null;
        if (complete || !term || rows.length >= target) break;
      }
      emit('ready');
    } catch (error) {
      if (disposed || current !== generation) return;
      failure = error instanceof ApiError ? error : new ApiError('invalid_response');
      if (failure.status === 401 || failure.status === 403) rows = [];
      emit('error');
    } finally { if (current === generation) active = null; }
  }
  return {
    search(nextTerm = '', nextFolder = null) {
      cancel();
      folder = nextFolder;
      term = nextTerm.toLocaleLowerCase();
      cursor = null; rows = []; complete = false; failure = null; seenCursors = new Set();
      if (kind === 'projects' && folder === null) { emit('idle'); return; }
      return more();
    },
    more,
    retry() {
      if (failure && ['invalid_cursor', 'cursor_expired'].includes(failure.code)) return this.search(term, folder);
      return more();
    },
    cancel,
    dispose() { disposed = true; cancel(); rows = []; },
  };
}
