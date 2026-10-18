import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createOverview } from '../src/overview.js';
import { defaultSelection } from '../src/selection.js';
import { deferred, envelope, metadata, wireTime } from './fixtures.js';

const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
const page = (changes = {}) => ({ ...envelope([{ execution_id: '9', folder_name: 'Scope', project_name: 'Project',
  package_name: 'Probe.dtsx', status: { code: 2, name: 'running' }, created_at: wireTime, started_at: wireTime,
  ended_at: null, duration_seconds: null, elapsed_seconds: 1, warning_count: 0, error_count: 0 }]),
meta: { ...envelope().meta, from, to, as_of: wireTime, upper_id: '99', consistency: 'live',
  sort: 'execution_id', direction: 'desc', limit: 50, has_more: false, next_cursor: null, ...changes } });
const summary = () => ({ ...envelope({ total: 1, by_status: [{ code: 1, name: 'created', count: 0 },
  { code: 2, name: 'running', count: 1 }, { code: 4, name: 'failed', count: 0 }, { code: 7, name: 'succeeded', count: 0 }] }),
meta: { ...envelope().meta, from, to, status_scope: 'all' } });
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(t, get, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const states = [], calls = [], settings = metadata();
  const owner = createOverview({ metadata: settings, pollIntervalMs: 1000, maxPollIntervalMs: 10000,
    ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    publish: state => states.push(state) });
  t.after(() => owner.dispose());
  return { owner, calls, states, selection: defaultSelection(settings), get state() { return states.at(-1); } };
}

test('automatic and manual refresh share one sequence, with a single next poll after completion', async t => {
  const run = setup(t, async resource => resource === 'executions' ? page() : summary());
  await run.owner.apply(run.selection);
  assert.equal(run.state.poll.nextAt, 1000);
  t.mock.timers.tick(500);
  await run.owner.refresh();
  assert.equal(run.state.poll.nextAt, 1500);
  t.mock.timers.tick(999);
  await flush();
  assert.equal(run.calls.length, 4);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(run.calls.length, 6);
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.poll.nextAt, 2500);
});

test('slow summary and repeated manual/visibility events produce no overlapping cycles', async t => {
  const pending = deferred();
  let summaries = 0;
  const run = setup(t, async resource => resource === 'executions' ? page()
    : ++summaries === 2 ? pending.promise : summary());
  await run.owner.apply(run.selection);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.state.phase, 'loading-summary');
  await run.owner.refresh();
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  run.owner.setVisible(true);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(run.calls.length, 4);
  pending.resolve(summary());
  await flush();
  assert.equal(run.state.poll.nextAt, 6000);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(run.calls.length, 6);
  assert.equal(run.state.poll.nextAt, 7000);
});

test('user pause stops auto requests across visibility changes, while manual refresh and resume remain usable', async t => {
  const run = setup(t, async resource => resource === 'executions' ? page() : summary());
  await run.owner.apply(run.selection);
  run.owner.togglePolling();
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(run.calls.length, 2);
  assert.equal(run.state.poll.mode, 'paused');
  await run.owner.refresh();
  assert.equal(run.calls.length, 4);
  assert.equal(run.state.poll.nextAt, null);
  run.owner.togglePolling();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(run.calls.length, 6);
});

test('a superseded automatic response cannot block or reschedule the new selection', async t => {
  const pending = deferred();
  let lists = 0;
  const run = setup(t, async resource => resource !== 'executions' ? summary()
    : ++lists === 2 ? pending.promise : page());
  await run.owner.apply(run.selection);
  t.mock.timers.tick(1000);
  await flush();
  const oldSignal = run.calls.at(-1).signal;
  await run.owner.apply({ ...run.selection, folder: 'New' });
  pending.reject(new ApiError('http', { status: 403 }));
  await flush();
  assert.equal(oldSignal.aborted, true);
  assert.equal(run.state.selection.folder, 'New');
  assert.equal(run.state.poll.mode, 'scheduled');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.calls.at(-2).params.folder, 'New');
});

test('transient errors back off with stale data; denied or malformed responses stop auto work until manual success', async t => {
  let lists = 0;
  const run = setup(t, async resource => {
    if (resource !== 'executions') return summary();
    lists += 1;
    if (lists === 2 || lists === 3) throw new ApiError('http', { status: 503 });
    if (lists === 4) throw new ApiError('http', { status: 403 });
    return page();
  });
  await run.owner.apply(run.selection);
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.state.pageStale, true);
  assert.equal(run.state.poll.delayMs, 1000);
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.state.poll.delayMs, 2000);
  t.mock.timers.tick(2000); await flush();
  assert.equal(run.state.page, null);
  assert.equal(run.state.poll.mode, 'blocked');
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  t.mock.timers.tick(60000); await flush();
  assert.equal(lists, 4);
  await run.owner.retryList();
  assert.equal(run.state.poll.mode, 'scheduled');
  assert.equal(run.state.poll.failures, 0);
});

test('automatic deeper refresh repeats the exact cursor/window and disposal cancels future polls', async t => {
  const run = setup(t, async (resource, { params }) => resource !== 'executions' ? summary()
    : page({ limit: 1, has_more: !params.cursor, next_cursor: params.cursor ? null : 'opaque+/%=' }));
  await run.owner.apply({ ...run.selection, limit: 1 });
  await run.owner.next();
  const entry = run.calls.at(-2).params;
  t.mock.timers.tick(1000); await flush();
  assert.deepEqual(run.calls.at(-2).params, entry);
  assert.equal(run.state.pageNumber, 2);
  run.owner.dispose();
  const count = run.calls.length, states = run.states.length;
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  t.mock.timers.tick(60000); await flush();
  assert.equal(run.calls.length, count);
  assert.equal(run.states.length, states);
});

test('an initial or restored page load already in progress covers visibility return without another resync', async t => {
  const pending = deferred();
  let lists = 0;
  const run = setup(t, async resource => resource !== 'executions' ? summary()
    : ++lists === 1 ? pending.promise : page(), { visible: false });
  const initial = run.owner.apply(run.selection);
  run.owner.setVisible(true);
  pending.resolve(page());
  await initial;
  t.mock.timers.tick(0); await flush();
  assert.equal(run.calls.length, 2);
  assert.equal(run.state.poll.nextAt, 1000);
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.calls.length, 4);
});

test('summary-only retry does not substitute for a full overview resync on visible return', async t => {
  const pending = deferred();
  let summaries = 0;
  const run = setup(t, async resource => {
    if (resource === 'executions') return page();
    summaries += 1;
    if (summaries === 1) throw new ApiError('http', { status: 503 });
    return summaries === 2 ? pending.promise : summary();
  });
  await run.owner.apply(run.selection);
  const retry = run.owner.retrySummary();
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  assert.equal(run.calls.length, 3);
  pending.resolve(summary());
  await retry;
  t.mock.timers.tick(0); await flush();
  assert.equal(run.calls.length, 5);
  assert.equal(run.calls.at(-2).resource, 'executions');
  assert.equal(run.state.poll.nextAt, 1000);
});

test('a malformed automatic response stops polling until an explicit successful retry', async t => {
  let lists = 0;
  const run = setup(t, async resource => resource !== 'executions' ? summary()
    : ++lists === 2 ? page({ as_of: 'invalid' }) : page());
  await run.owner.apply(run.selection);
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.state.error.kind, 'invalid_response');
  assert.equal(run.state.poll.mode, 'blocked');
  t.mock.timers.tick(60000); await flush();
  assert.equal(lists, 2);
  await run.owner.retryList();
  assert.equal(run.state.poll.mode, 'scheduled');
});

test('a timed-out automatic request cannot overlap a retry and keeps its old observations stale', async t => {
  let lists = 0;
  const run = setup(t, async (resource, { signal }) => {
    if (resource !== 'executions') return summary();
    if (++lists === 2) return new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    return page();
  });
  await run.owner.apply(run.selection);
  t.mock.timers.tick(1000); await flush();
  t.mock.timers.tick(29999); await flush();
  assert.equal(lists, 2);
  assert.equal(run.state.poll.nextAt, null);
  t.mock.timers.tick(1); await flush();
  assert.equal(run.state.error.kind, 'timeout');
  assert.equal(run.state.pageStale, true);
  assert.equal(run.state.poll.delayMs, 10000);
  t.mock.timers.tick(10000); await flush();
  assert.equal(lists, 3);
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.poll.delayMs, 1000);
});
