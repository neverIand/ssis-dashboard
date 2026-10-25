import { ApiError } from './api.js';
import { createDisplay, formatCode, formatId, formatText } from './display.js';
import { selectionParams, timestampTicks, validateSelection } from './selection.js';
import { createRefreshLoop } from './refresh-loop.js';
import { readTimeline, timelineParams, timelineScope } from './timeline.js';
import { createServerClock, presetRange } from './time-range.js';

const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;
const badResponse = (response) => new ApiError('invalid_response', { requestId: response?.meta?.request_id });
const transient = (error) => ['network', 'timeout'].includes(error.kind)
  || (error.kind === 'http' && (error.status >= 500 || [408, 429].includes(error.status)));
const copyPath = (path) => ({ ...path, entries: [...path.entries] });

function wireTime(value, display, nullable = true) {
  if (value === null && !nullable) throw new TypeError();
  if (value !== null && (typeof value !== 'string' || !utc.test(value))) throw new TypeError();
  display.timestamp(value);
}

function requiredCount(value, display) {
  if (value === null) throw new TypeError();
  display.count(value);
}

function code(value) {
  if (value === null || value.code < -2147483648 || value.code > 2147483647) throw new TypeError();
  formatCode(value);
}

function name(value, width) {
  formatText(value);
  if (!value || value.length > width || value.includes('\0')) throw new TypeError();
}

export function readExecutionPage(response, selection, metadata, display) {
  try {
    const { data, meta } = response;
    if (!Array.isArray(data) || data.length > selection.limit || meta.limit !== selection.limit
        || meta.sort !== selection.sort || meta.direction !== selection.direction
        || meta.consistency !== 'live'
        || typeof meta.has_more !== 'boolean'
        || (meta.has_more ? typeof meta.next_cursor !== 'string' || !meta.next_cursor
          || meta.next_cursor.length > metadata.limits.max_cursor_characters || !data.length
          : meta.next_cursor !== null)) throw new TypeError();
    if (meta.upper_id === null) { if (data.length) throw new TypeError(); }
    else formatId(meta.upper_id);
    wireTime(meta.from, display, false);
    wireTime(meta.to, display, false);
    wireTime(meta.as_of, display, false);
    wireTime(meta.generated_at, display, false);
    const span = timestampTicks(meta.to) - timestampTicks(meta.from);
    if (span <= 0n || span > BigInt(metadata.limits.max_range_hours) * 36000000000n) throw new TypeError();
    if ((selection.from !== null && timestampTicks(selection.from) !== timestampTicks(meta.from))
        || (selection.to !== null && timestampTicks(selection.to) !== timestampTicks(meta.to))) throw new TypeError();
    const ids = new Set();
    for (const row of data) {
      if (typeof row.execution_id !== 'string' || ids.has(row.execution_id)) throw new TypeError();
      formatId(row.execution_id);
      ids.add(row.execution_id);
      name(row.folder_name, 128);
      name(row.project_name, 128);
      name(row.package_name, 260);
      code(row.status);
      wireTime(row.created_at, display, false);
      const created = timestampTicks(row.created_at);
      if (created < timestampTicks(meta.from) || created >= timestampTicks(meta.to)
          || (selection.status.length && !selection.status.includes(row.status.code))) throw new TypeError();
      wireTime(row.started_at, display);
      wireTime(row.ended_at, display);
      display.duration(row.duration_seconds);
      display.duration(row.elapsed_seconds);
      requiredCount(row.warning_count, display);
      requiredCount(row.error_count, display);
      if ((row.started_at === null && (row.duration_seconds !== null || row.elapsed_seconds !== null))
          || (row.ended_at === null && row.duration_seconds !== null)) throw new TypeError();
    }
    return response;
  } catch { throw badResponse(response); }
}

export function readSummary(response, page, metadata, display) {
  try {
    const { data, meta } = response;
    wireTime(meta.generated_at, display, false);
    if (meta.from !== page.meta.from || meta.to !== page.meta.to || meta.status_scope !== 'all'
        || !Array.isArray(data.by_status) || data.by_status.length > 65536) throw new TypeError();
    requiredCount(data.total, display);
    const codes = new Set();
    let total = 0n;
    for (const item of data.by_status) {
      code(item);
      requiredCount(item.count, display);
      if (codes.has(item.code)) throw new TypeError();
      codes.add(item.code);
      total += BigInt(item.count);
    }
    if (total !== BigInt(data.total) || [2, 4, 7].some((value) => !codes.has(value))
        || metadata.execution_statuses.some((item) => !codes.has(item.code))) {
      throw new TypeError();
    }
    return response;
  } catch { throw badResponse(response); }
}

export function createOverview({ api, metadata, publish, timeoutMs = 30000, locale, retainedPaths = [],
  autoRefresh = true, visible = true, pollIntervalMs = 30000, maxPollIntervalMs = 300000, restoreTimeline = null,
  serverTime = null, monotonicNow }) {
  const display = createDisplay({ timeZone: metadata.display_timezone, locale });
  const clock = createServerClock(serverTime, monotonicNow);
  let state = { phase: 'idle', selection: null, page: null, summary: null, error: null, notice: '',
    operation: null, pageStale: false, summaryStale: false, timeline: {open:restoreTimeline?.open === true,
      bucket:['day','hour'].includes(restoreTimeline?.bucket) ? restoreTimeline.bucket : 'day', page:null, scope:null, error:null,
        stale:false} };
  // Keep request paths only, never rows or cursor tokens in history.state or storage.
  const contexts = new Map(retainedPaths.map(([id, path]) => [id, copyPath(path)]));
  const key = (selection) => JSON.stringify({ ...selectionParams(selection), created: selection.created ?? null });
  let context = null;
  let generation = 0;
  let active = null;
  let disposed = false;
  let timelineAfter = 'ready';
  const busy = () => ['loading-list', 'loading-summary', 'loading-timeline'].includes(state.phase);
  const show = (poll) => {
    publish({ ...state, poll, busy: busy(), pageNumber: (context?.index ?? 0) + 1,
      hasPrevious: !busy() && Boolean(context?.index),
      hasNext: !busy() && Boolean(state.page?.meta.has_more) });
  };
  const loop = createRefreshLoop({ refresh, publish: show, paused: !autoRefresh, visible,
    intervalMs: pollIntervalMs, maxIntervalMs: maxPollIntervalMs });
  const emit = (changes) => {
    state = { ...state, ...changes };
    if (state.page === null) state = {...state, timeline:{...state.timeline, page:null, scope:null, error:null, stale:false}};
    const errors = [state.error, state.timeline.open ? state.timeline.error : null].filter(Boolean);
    show(loop.update({ busy: busy(), eligible: state.selection !== null,
      coversReturn: state.operation === 'page',
      failed: errors.length > 0,
      retryable: errors.every(transient) }));
  };

  function remember() {
    if (state.selection === null || context === null) return;
    const id = key(state.selection);
    contexts.delete(id);
    contexts.set(id, copyPath(context));
    if (contexts.size > 8) contexts.delete(contexts.keys().next().value);
  }

  function denied() {
    contexts.clear();
    context = { entries: [null], index: 0, cohort: null };
  }

  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller.abort(); }
    active = null;
  }

  async function request(resource, params) {
    const controller = new AbortController();
    let timedOut = false;
    const job = { controller, timer: setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) };
    active = job;
    try {
      const response = await api.get(resource, { params, signal: controller.signal });
      if (controller.signal.aborted) throw new ApiError('timeout');
      return response;
    } catch (error) {
      throw timedOut ? new ApiError('timeout') : error instanceof ApiError ? error : new ApiError('invalid_response');
    } finally {
      clearTimeout(job.timer);
      if (active === job) active = null;
    }
  }

  async function summary(current, selection, page) {
    const previous = state.summary?.meta.from === page.meta.from && state.summary.meta.to === page.meta.to
      ? state.summary : null;
    if (state.timeline.scope !== timelineScope(selection,page)) state = {...state,
      timeline:{...state.timeline, page:null, error:null, stale:false, scope:null}};
    let afterPhase = 'ready';
    emit({ phase: 'loading-summary', page, pageStale: false, summary: previous, summaryStale: previous !== null, error: null });
    try {
      const response = await request('metrics/summary', { folder: selection.folder, project: selection.project,
        from: page.meta.from, to: page.meta.to });
      if (disposed || current !== generation) return;
      emit({ phase: state.timeline.open ? 'loading-summary' : 'ready', summary: readSummary(response, page, metadata, display),
        summaryStale: false });
    } catch (error) {
      if (!disposed && current === generation) {
        if ([401, 403].includes(error.status)) {
          denied();
          emit({ phase: 'list-error', page: null, summary: null, pageStale: false, summaryStale: false, error });
          return;
        }
        else { afterPhase = 'summary-error'; emit({ phase: state.timeline.open ? 'loading-summary' : afterPhase,
          summary: transient(error) ? previous : null,
          summaryStale: transient(error) && previous !== null, error });
        }
      }
    }
    if (!disposed && current === generation && state.timeline.open) await timeline(current,selection,page,afterPhase);
  }

  async function timeline(current,selection,page,afterPhase = state.phase === 'summary-error' ? 'summary-error' : 'ready') {
    const {bucket} = state.timeline, scope = timelineScope(selection,page);
    const previous = state.timeline.scope === scope && state.timeline.page?.meta.bucket === bucket ? state.timeline.page : null;
    timelineAfter = afterPhase;
    emit({phase:'loading-timeline', timeline:{...state.timeline, page:previous, scope, error:null, stale:previous !== null}});
    try {
      const response = await request('metrics/timeline',timelineParams(selection,page,bucket));
      if (disposed || current !== generation) return;
      const result = readTimeline(response,selection,page,bucket,metadata,display);
      emit({phase:afterPhase,timeline:{...state.timeline,page:result,error:null,stale:false}});
    } catch (error) {
      if (disposed || current !== generation) return;
      if ([401,403].includes(error.status)) {
        denied(); emit({phase:'list-error',page:null,summary:null,pageStale:false,summaryStale:false,error});
      } else emit({phase:afterPhase,timeline:{...state.timeline,error,page:transient(error) ? previous : null,
        stale:transient(error) && previous !== null}});
    }
  }

  async function load(index, { notice = '', operation = 'page' } = {}) {
    const previousPage = operation === 'refresh' ? state.page : null;
    const previousSummary = operation === 'refresh' ? state.summary : null;
    cancel();
    const current = generation;
    const selection = state.selection;
    context = { ...context, entries: [...context.entries], index };
    const cursor = context.entries[index];
    const cohort = index === 0 && (operation === 'refresh' || selection.created) ? null : context.cohort;
    emit({ phase: 'loading-list', page: previousPage, summary: previousSummary,
      timeline:{...state.timeline,page:operation === 'refresh' ? state.timeline.page : null,error:null,
        stale:operation === 'refresh' && state.timeline.page !== null},
      pageStale: previousPage !== null, summaryStale: previousSummary !== null, operation, error: null, notice });
    try {
      const bounds = cohort ? { from: cohort.from, to: cohort.to }
        : selection.created ? presetRange(selection.created, clock.read(), metadata.display_timezone) : {};
      if (selection.created) validateSelection({ ...selection, created: null, ...bounds }, metadata);
      const params = { ...selectionParams(selection), ...bounds, ...(cursor === null ? {} : { cursor }) };
      const response = await request('executions', params);
      if (disposed || current !== generation) return;
      const page = readExecutionPage(response, { ...selection, ...bounds }, metadata, display);
      clock.observe(page.meta.generated_at);
      if (cohort && (page.meta.from !== cohort.from || page.meta.to !== cohort.to
          || (cursor !== null && (page.meta.as_of !== cohort.as_of || page.meta.upper_id !== cohort.upper_id)))) {
        throw badResponse(response);
      }
      // The API has no first-page cursor. Replaying page one establishes a new
      // fence inside the retained bounds; rebuild its subsequent path.
      context = { index, entries: context.entries.slice(0, index + 1),
        cohort: { from: page.meta.from, to: page.meta.to, as_of: page.meta.as_of, upper_id: page.meta.upper_id } };
      if (page.meta.has_more) context.entries.push(page.meta.next_cursor);
      remember();
      await summary(current, selection, page);
    } catch (error) {
      if (disposed || current !== generation) return;
      if (cursor !== null && ['invalid_cursor', 'cursor_expired'].includes(error.code)) {
        contexts.delete(key(selection));
        context = { entries: [null], index: 0, cohort: null };
        // This fallback has no cursor, so a second failure cannot reset again.
        return load(0, { notice: 'The page link expired or is no longer valid. Reset to page one.' });
      }
      if ([401, 403].includes(error.status)) denied();
      const keep = transient(error) && previousPage !== null;
      emit({ phase: 'list-error', page: keep ? previousPage : null, summary: keep ? previousSummary : null,
        pageStale: keep, summaryStale: keep && previousSummary !== null, error });
    }
  }

  async function apply(selection, { restore = false } = {}) {
    if (disposed) return;
    if (busy() && state.operation === 'page' && context?.index === 0 && selection !== null
        && state.selection !== null && key(selection) === key(state.selection)) return;
    remember();
    cancel();
    loop.reset();
    if (selection === null) {
      context = null;
      emit({ phase: 'idle', selection: null, page: null, summary: null, error: null, notice: '',
        operation: null, pageStale: false, summaryStale: false });
      return;
    }
    const saved = restore ? contexts.get(key(selection)) : null;
    context = saved ? { ...saved, entries: [...saved.entries] } : { entries: [null], index: 0, cohort: null };
    state = { ...state, selection };
    return load(context.index);
  }

  function refresh() {
    if (!disposed && !busy() && state.selection !== null) return load(context.index, { operation: 'refresh' });
  }

  function retryTimeline() {
    if (disposed || busy() || !state.timeline.open || !state.page) return;
    if (state.pageStale) return refresh();
    state = {...state,operation:'timeline'};
    return timeline(generation,state.selection,state.page);
  }

  function toggleTimeline() {
    if (disposed || !state.page) return;
    const open = !state.timeline.open;
    if (!open && state.phase === 'loading-timeline') { cancel(); state = {...state,phase:timelineAfter}; }
    state = {...state,timeline:{...state.timeline,open,page:null,scope:null,error:null,stale:false}};
    if (!open && !state.error) loop.reset();
    emit({});
    if (open && !busy()) return retryTimeline();
  }

  return {
    apply,
    refresh,
    effectiveWindow: () => state.page ? { from: state.page.meta.from, to: state.page.meta.to } : null,
    toggleTimeline, retryTimeline,
    setTimelineBucket(bucket) {
      if (!['day','hour'].includes(bucket)) throw new TypeError('Choose Day or Hour.');
      if (disposed || busy() || !state.timeline.open || !state.page || state.timeline.bucket === bucket) return;
      state = {...state,timeline:{...state.timeline,bucket,page:null,error:null,stale:false}};
      return retryTimeline();
    },
    checkpointTimeline: () => ({open:state.timeline.open,bucket:state.timeline.bucket}),
    setVisible: loop.setVisible,
    togglePolling: () => loop.togglePaused(),
    checkpoint() {
      remember();
      return [...contexts].map(([id, path]) => [id, copyPath(path)]);
    },
    next() {
      if (!disposed && !busy() && state.page?.meta.has_more) return load(context.index + 1);
    },
    previous() {
      if (!disposed && !busy() && context?.index > 0) return load(context.index - 1);
    },
    latest() {
      if (!disposed && !busy() && state.selection !== null) return apply(state.selection);
    },
    retryList() {
      if (!disposed && !busy() && state.phase === 'list-error') {
        return load(context.index, { notice: state.notice, operation: state.operation });
      }
    },
    retrySummary() {
      if (disposed || busy() || state.phase !== 'summary-error') return;
      cancel();
      state = { ...state, operation: 'summary-retry' };
      return summary(generation, state.selection, state.page);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      cancel();
      contexts.clear();
      context = null;
      emit({ phase: 'idle', selection: null, page: null, summary: null, error: null, notice: '',
        operation: null, pageStale: false, summaryStale: false });
    },
  };
}
