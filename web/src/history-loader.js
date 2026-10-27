import { ApiError } from './api.js';
import { createDisplay } from './display.js';
import { createRefreshLoop } from './refresh-loop.js';
import { readHistoryPage } from './history.js';
import { historySelection } from './history-navigation.js';

const retryable = error => ['network', 'timeout'].includes(error.kind)
  || (error.kind === 'http' && (error.status >= 500 || [408, 429].includes(error.status)));
const empty = () => ({ open: true, phase: 'idle', page: null, error: null, stale: false, notice: '' });

export function createHistoryLoader({ api, metadata, selection, publish, paused = false, visible = true, timeoutMs = 30000 }) {
  const display = createDisplay({ timeZone: metadata.display_timezone });
  let query = historySelection(selection, metadata), path = [null], index = 0, cohort = null;
  let active = null, generation = 0, disposed = false, valid = true;
  let state = empty();
  const notify = () => publish({ ...state, query, busy: active !== null, pageNumber: index + 1,
    hasPrevious: index > 0, hasNext: state.page?.meta.has_more === true, poll: loop.snapshot() });
  const loop = createRefreshLoop({ paused, visible, refresh: () => run(), publish: notify });
  const emit = changes => {
    state = { ...state, ...changes };
    loop.update({ busy: active !== null, eligible: valid, failed: state.error !== null,
      retryable: state.error === null || retryable(state.error), coversReturn: true });
    notify();
  };
  function cancel() {
    generation += 1;
    if (active) { active.controller.abort(); clearTimeout(active.timer); active = null; }
  }
  async function run(target = index, reset = false) {
    if (disposed || active || !valid) return;
    const current = ++generation, controller = new AbortController();
    let timedOut = false, previous = reset ? null : state.page;
    const job = { controller, timer: setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) };
    active = job;
    emit({ phase: 'loading', page: previous, error: null, stale: previous !== null, notice: '' });
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cursor = path[target];
        try {
          response = await api.get('history', { params: { ...query, ...(cursor ? { cursor } : {}) }, signal: controller.signal });
          break;
        } catch (error) {
          if (disposed || current !== generation) return;
          if (!cursor || !['invalid_cursor', 'cursor_expired'].includes(error.code) || attempt) throw error;
          target = index = 0; path = [null]; cohort = null; previous = null;
          emit({ page: null, stale: false, notice: 'The history page link expired. Reset to page one.' });
        }
      }
      if (disposed || current !== generation) return;
      if (timedOut) throw new ApiError('timeout');
      const page = readHistoryPage(response, null, query, metadata, display, { collection: true });
      if (path[target] && (page.meta.as_of !== cohort?.as_of || page.meta.upper_id !== cohort?.upper_id)) {
        throw new ApiError('invalid_response', { requestId: page.meta.request_id });
      }
      index = target; path = path.slice(0, index + 1);
      if (page.meta.has_more) path.push(page.meta.next_cursor);
      cohort = { as_of: page.meta.as_of, upper_id: page.meta.upper_id };
      state = { ...state, phase: 'ready', page, error: null, stale: false };
    } catch (error) {
      if (disposed || current !== generation) return;
      const failure = timedOut ? new ApiError('timeout') : error instanceof ApiError ? error : new ApiError('invalid_response');
      state = { ...state, phase: 'error', error: failure, page: retryable(failure) ? previous : null,
        stale: retryable(failure) && previous !== null };
      if (!retryable(failure)) { path = [null]; index = 0; cohort = null; }
    } finally {
      clearTimeout(job.timer);
      if (!disposed && current === generation) { active = null; emit({}); }
    }
  }
  return { load: () => run(), refresh: () => run(), retry: () => run(),
    select(value) {
      query = historySelection(value, metadata);
      valid = true;
      cancel(); loop.reset(); path = [null]; index = 0; cohort = null;
      state = empty();
      return run(0, true);
    },
    next: () => !active && state.page?.meta.has_more ? run(index + 1, true) : undefined,
    previous: () => !active && index > 0 ? run(index - 1, true) : undefined,
    latest() { if (!active) { path = [null]; index = 0; cohort = null; return run(0, true); } },
    setVisible: loop.setVisible,
    togglePolling: () => loop.togglePaused(),
    clear() {
      cancel(); loop.reset(); path = [null]; index = 0; cohort = null; valid = false;
      emit(empty());
    },
    dispose() { disposed = true; cancel(); loop.dispose(); path = []; cohort = null; state = { page: null }; },
  };
}
