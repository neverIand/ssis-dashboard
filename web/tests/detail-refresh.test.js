import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { deferred, metadata } from './fixtures.js';
import { detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, get, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const states = [], calls = [];
  const owner = createDetailLoader({ executionId: '17', metadata: metadata(),
    pollIntervalMs: 1000, maxPollIntervalMs: 10000, ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    publish: state => states.push(state) });
  t.after(() => owner.dispose());
  return { owner, states, calls, get state() { return states.at(-1); } };
}

test('detail polling and manual activation share one completion-based operation', async t => {
  const second = deferred();
  let count = 0;
  const run = setup(t, () => ++count === 2 ? second.promise : runningDetailResponse('17'));
  await run.owner.load();
  assert.equal(run.state.poll.nextAt, 1000);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.state.busy, true);
  assert.equal(run.state.stale, true);
  await run.owner.refresh();
  await run.owner.load();
  t.mock.timers.tick(4000);
  assert.equal(run.calls.length, 2);
  second.resolve(runningDetailResponse('17'));
  await flush();
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.poll.nextAt, 15000); // The slow cycle cost is capped at 10 seconds.
});

test('only transient same-ID failures retain their observed data and back off', async t => {
  let failure = null;
  const run = setup(t, async () => { if (failure) throw failure; return runningDetailResponse('17'); });
  await run.owner.load();
  const first = run.state.response;
  failure = new ApiError('http', { status: 503 });
  await run.owner.refresh();
  assert.equal(run.state.response, first);
  assert.equal(run.state.stale, true);
  assert.equal(run.state.poll.delayMs, 1000);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.state.poll.delayMs, 2000);
  failure = null;
  await run.owner.refresh();
  assert.equal(run.state.stale, false);
  assert.equal(run.state.poll.failures, 0);
});

test('denial, absence and malformed responses clear protected data and stop automatic retry', async t => {
  const run = setup(t, async () => runningDetailResponse('17'));
  await run.owner.load();
  run.owner.dispose();
  for (const status of [401, 403, 404, 'invalid']) {
    const states = [];
    let attempts = 0;
    const owner = createDetailLoader({ executionId: '17', metadata: metadata(), pollIntervalMs: 1000,
      api: { async get() {
        if (++attempts === 1) return runningDetailResponse('17');
        if (status === 'invalid') return runningDetailResponse('18');
        throw new ApiError('http', { status });
      } }, publish: state => states.push(state) });
    await owner.load();
    await owner.refresh();
    assert.equal(states.at(-1).response, null);
    assert.equal(states.at(-1).stale, false);
    assert.equal(states.at(-1).poll.mode, 'blocked');
    t.mock.timers.tick(60000);
    await flush();
    assert.equal(attempts, 2);
    owner.dispose();
  }
});

test('late A success or denial cannot overwrite B, including A to B to A navigation', async t => {
  for (const lateFailure of [false, true]) {
    const late = deferred();
    let attempt = 0;
    const run = setupRace(t, (resource) => ++attempt === 1 ? late.promise : runningDetailResponse(resource.split('/').at(-1)));
    const old = run.owner.load();
    const oldSignal = run.calls[0].signal;
    await run.owner.select('18');
    assert.equal(oldSignal.aborted, true);
    assert.equal(run.state.executionId, '18');
    assert.equal(run.state.response.data.execution_id, '18');
    await run.owner.select('17');
    const latest = run.state.response;
    if (lateFailure) late.reject(new ApiError('http', { status: 403 }));
    else late.resolve(runningDetailResponse('17'));
    await old;
    assert.equal(run.state.response, latest);
    assert.equal(run.state.poll.mode, 'scheduled');
    run.owner.dispose();
  }
});

function setupRace(t, get) {
  const states = [], calls = [];
  const owner = createDetailLoader({ executionId: '17', metadata: metadata(),
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    publish: state => states.push(state) });
  t.after(() => owner.dispose());
  return { owner, calls, get state() { return states.at(-1); } };
}

test('switching IDs clears an old transient observation before new request completion', async t => {
  const pending = deferred();
  let attempts = 0;
  const run = setup(t, async () => ++attempts === 1 ? runningDetailResponse('17') : pending.promise);
  await run.owner.load();
  const request = run.owner.select('18');
  assert.equal(run.state.response, null);
  assert.equal(run.state.executionId, '18');
  pending.reject(new ApiError('http', { status: 503 }));
  await request;
  assert.equal(run.state.response, null);
  assert.equal(run.state.stale, false);
});

test('pause, resume and visibility recovery coalesce with a pending detail refresh', async t => {
  const pending = deferred();
  let attempts = 0;
  const run = setup(t, () => ++attempts === 2 ? pending.promise : runningDetailResponse('17'));
  await run.owner.load();
  run.owner.togglePolling();
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(attempts, 1);
  const work = run.owner.refresh();
  run.owner.togglePolling();
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  run.owner.setVisible(true);
  assert.equal(attempts, 2);
  pending.resolve(runningDetailResponse('17'));
  await work;
  t.mock.timers.tick(0);
  await flush();
  assert.equal(attempts, 3);
  assert.equal(run.state.poll.nextAt, 11000);
});

test('detail deadline retains only same-ID data, then disposal aborts pending work and polling', async t => {
  let attempts = 0, signal;
  const run = setup(t, (resource, options) => {
    signal = options.signal;
    if (++attempts === 1) return runningDetailResponse('17');
    return new Promise((resolve, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  }, { timeoutMs: 10000 });
  await run.owner.load();
  const request = run.owner.refresh();
  t.mock.timers.tick(10000);
  await request;
  assert.equal(signal.aborted, true);
  assert.equal(run.state.error.kind, 'timeout');
  assert.equal(run.state.stale, true);
  const work = run.owner.refresh();
  const stateCount = run.states.length;
  run.owner.dispose();
  assert.equal(signal.aborted, true);
  await work;
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(attempts, 3);
  assert.equal(run.states.length, stateCount);
});

test('an ended initial load completes its active tab and never schedules automatic work', async t => {
  const run = setup(t, resource => resource.endsWith('/executables') ? executablePage() : detailResponse('17'),
    { initialTab: {} });
  await run.owner.load();
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.executables.phase, 'ready');
  assert.equal(run.state.terminal, true);
  assert.equal(run.state.poll.nextAt, null);
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  run.owner.togglePolling();
  assert.equal(run.state.poll.paused, false);
  t.mock.timers.tick(600000);
  await flush();
  assert.deepEqual(run.calls.map(call => call.resource), ['executions/17', 'executions/17/executables']);
});

test('a running to ended automatic cycle finishes its tab, then stops even after a visible return during the tab read', async t => {
  const pending = deferred();
  let baseReads = 0, sectionReads = 0;
  const run = setup(t, resource => resource.endsWith('/executables')
    ? ++sectionReads === 2 ? pending.promise : executablePage()
    : ++baseReads === 1 ? runningDetailResponse('17') : detailResponse('17'), { initialTab: {} });
  await run.owner.load();
  assert.equal(run.state.poll.nextAt, 1000);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.state.terminal, true);
  assert.equal(run.state.busy, true);
  assert.equal(run.calls.length, 4);
  run.owner.setVisible(false);
  run.owner.setVisible(true);
  pending.resolve(executablePage());
  await flush();
  assert.equal(run.state.busy, false);
  assert.equal(run.state.executables.phase, 'ready');
  assert.equal(run.state.poll.nextAt, null);
  t.mock.timers.tick(600000);
  await flush();
  assert.equal(run.calls.length, 4);
});

test('terminal base failures retain polling eligibility even when protected data is cleared', async t => {
  let failure = null;
  const run = setup(t, () => { if (failure) throw failure; return detailResponse('17'); });
  await run.owner.load();
  for (const error of [new ApiError('network'), new ApiError('timeout'), new ApiError('http', { status: 503 }),
    new ApiError('http', { status: 403 }), new ApiError('invalid_response')]) {
    failure = error;
    await run.owner.refresh();
    assert.equal(run.state.terminal, true);
    assert.equal(run.state.poll.nextAt, null);
    run.owner.setVisible(false);
    run.owner.setVisible(true);
    const before = run.calls.length;
    t.mock.timers.tick(600000);
    await flush();
    assert.equal(run.calls.length, before);
  }
  assert.equal(run.state.response, null);
});

test('a terminal cycle with a transient active-tab failure does not schedule backoff', async t => {
  const run = setup(t, resource => {
    if (resource.endsWith('/executables')) throw new ApiError('http', { status: 503 });
    return detailResponse('17');
  }, { initialTab: {} });
  await run.owner.load();
  assert.equal(run.state.executables.phase, 'error');
  assert.equal(run.state.terminal, true);
  assert.equal(run.state.poll.nextAt, null);
  t.mock.timers.tick(600000);
  await flush();
  assert.equal(run.calls.length, 2);
});

test('manual Refresh still makes two reads while terminal, and a successful running read re-enables polling', async t => {
  let ended = true;
  const run = setup(t, resource => resource.endsWith('/executables') ? executablePage()
    : ended ? detailResponse('17') : runningDetailResponse('17'), { initialTab: {} });
  await run.owner.load();
  await run.owner.refresh();
  assert.deepEqual(run.calls.slice(2).map(call => call.resource), ['executions/17', 'executions/17/executables']);
  assert.equal(run.state.poll.nextAt, null);
  ended = false;
  await run.owner.refresh();
  assert.equal(run.state.terminal, false);
  assert.equal(run.state.poll.nextAt, 1000);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(run.calls.length, 8);
});

test('a late ended response cannot stop the newly selected running execution', async t => {
  const pending = deferred();
  const run = setup(t, resource => resource === 'executions/17' ? pending.promise : runningDetailResponse('18'));
  const old = run.owner.load();
  await run.owner.select('18');
  pending.resolve(detailResponse('17'));
  await old;
  assert.equal(run.state.executionId, '18');
  assert.equal(run.state.terminal, false);
  assert.equal(run.state.poll.nextAt, 1000);
});

test('selecting a running execution after an ended execution restores normal scheduling', async t => {
  const run = setup(t, resource => resource === 'executions/17' ? detailResponse('17') : runningDetailResponse('18'));
  await run.owner.load();
  assert.equal(run.state.terminal, true);
  await run.owner.select('18');
  assert.equal(run.state.terminal, false);
  assert.equal(run.state.poll.nextAt, 1000);
});
