import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { executableQuery, readExecutablePage } from '../src/executables.js';
import { deferred, metadata, wireTime } from './fixtures.js';
import { detailResponse } from './detail-fixture.js';
import { executable, executablePage } from './executable-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const display = createDisplay({ timeZone: 'Europe/London' });
const query = { sort: 'started_at', direction: 'asc', limit: 50 };
function setup(t, get, options = {}) {
  const states = [], calls = [];
  const owner = createDetailLoader({ metadata: metadata(), executionId: '17', autoRefresh: false, ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    publish: state => states.push(state) });
  t.after(() => owner.dispose());
  return { owner, calls, get state() { return states.at(-1); } };
}

test('executable DTO preserves invocation identities, exact text/times, NULL, zero and result vocabulary', () => {
  const page = executablePage([executable('9007199254740993', { name: null, package_path: null }),
    executable('9223372036854775807', { result: { code: -32768, name: 'unknown' },
      ended_at: wireTime, duration_seconds: 0, execution_path: '😀'.repeat(16384) })]);
  assert.equal(readExecutablePage(page, '17', query, metadata(), display), page);
  assert.equal(page.data[0].executable_id, page.data[1].executable_id);
  assert.equal(page.data[1].started_at, wireTime);
  for (const mutate of [p => { p.data[0].execution_id = '18'; }, p => { p.data[0].statistics_id = null; },
    p => { p.data[0].executable_id = '0'; }, p => { p.data[0].statistics_id = p.data[1].statistics_id; },
    p => { p.data[0].name = 'x'.repeat(4001); }, p => { p.data[0].execution_path = '😀'.repeat(16385); },
    p => { p.data[0].duration_seconds = 0; }, p => { p.data[0].result = { code: 0, name: 'succeeded' }; },
    p => { p.meta.sort = 'execution_id'; }, p => { p.meta.from = wireTime; },
    p => { p.meta.has_more = true; p.meta.next_cursor = ''; }, p => { p.meta.upper_id = '1'; }]) {
    const bad = structuredClone(page); mutate(bad);
    assert.throws(() => readExecutablePage(bad, '17', query, metadata(), display), error => error.kind === 'invalid_response');
  }
  for (const value of [{ ...query, sort: 'name' }, { ...query, limit: 201 }, { ...query, limit: 1.5 }]) {
    assert.throws(() => executableQuery(value, metadata()));
  }
});

test('section loads only when opened; paging and refresh retain query/path while order starts page one', async t => {
  const run = setup(t, async (resource, { params }) => resource.endsWith('/executables')
    ? executablePage([executable(params.cursor ? '2' : '1')], { ...params, has_more: !params.cursor,
      next_cursor: params.cursor ? null : 'entry-A' }) : detailResponse('17'));
  await run.owner.load();
  assert.equal(run.calls.length, 1);
  await run.owner.toggleExecutables();
  assert.equal(run.calls.length, 2);
  await run.owner.nextExecutables();
  assert.equal(run.state.executables.pageNumber, 2);
  assert.equal(run.calls.at(-1).params.cursor, 'entry-A');
  await run.owner.refresh();
  assert.deepEqual(run.calls.slice(-2).map(call => call.resource), ['executions/17', 'executions/17/executables']);
  assert.equal(run.calls.at(-1).params.cursor, 'entry-A');
  await run.owner.orderExecutables({ sort: 'statistics_id', direction: 'desc', limit: 1 });
  assert.equal(run.calls.at(-1).params.cursor, undefined);
  assert.equal(run.state.executables.pageNumber, 1);
  assert.equal(run.state.executables.query.limit, 1);
  await run.owner.toggleExecutables();
  await run.owner.refresh();
  assert.equal(run.calls.at(-1).resource, 'executions/17');
  assert.equal(run.state.executables.page, null);
});

test('one scheduler waits for base plus section and coalesces manual/paging/visibility actions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = deferred(); let sections = 0;
  const run = setup(t, async resource => !resource.endsWith('/executables') ? detailResponse('17')
    : ++sections === 2 ? pending.promise : executablePage(),
  { autoRefresh: true, pollIntervalMs: 1000, maxPollIntervalMs: 10000 });
  await run.owner.load(); await run.owner.toggleExecutables();
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.state.busy, true);
  const count = run.calls.length;
  await run.owner.refresh(); await run.owner.nextExecutables();
  run.owner.setVisible(false); run.owner.setVisible(true);
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.calls.length, count);
  pending.resolve(executablePage()); await flush();
  t.mock.timers.tick(0); await flush();
  assert.equal(run.calls.length, count + 2, 'One queued visible-return cycle uses the same owner');
  assert.equal(run.state.busy, false);
  assert.equal(run.state.poll.nextAt, 3000);
});

test('closing a pending section aborts it, removes data and rejects late denial after reopen', async t => {
  const late = deferred(); let attempts = 0;
  const run = setup(t, resource => resource.endsWith('/executables')
    ? ++attempts === 1 ? late.promise : executablePage() : Promise.resolve(detailResponse('17')));
  await run.owner.load(); const old = run.owner.toggleExecutables();
  const signal = run.calls.at(-1).signal;
  await run.owner.toggleExecutables();
  assert.equal(signal.aborted, true);
  assert.equal(run.state.executables.open, false);
  await run.owner.toggleExecutables();
  const page = run.state.executables.page;
  late.reject(new ApiError('http', { status: 404 })); await old;
  assert.equal(run.state.executables.page, page);
  assert.equal(run.state.phase, 'ready');
});

test('an expired deep refresh resets once and never relabels its old page after fallback failure', async t => {
  let expired = false, fallbackFails = false;
  const run = setup(t, async (resource, { params }) => {
    if (!resource.endsWith('/executables')) return detailResponse('17');
    if (expired && params.cursor) throw new ApiError('http', { status: 400, code: 'cursor_expired' });
    if (fallbackFails && !params.cursor) throw new ApiError('http', { status: 503 });
    return executablePage([executable(params.cursor ? '2' : '1')], { has_more: !params.cursor, next_cursor: params.cursor ? null : 'entry-A' });
  });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.nextExecutables();
  expired = fallbackFails = true;
  const before = run.calls.length;
  await run.owner.refresh();
  assert.equal(run.calls.length, before + 3);
  assert.equal(run.state.executables.pageNumber, 1);
  assert.equal(run.state.executables.page, null);
  assert.match(run.state.executables.notice, /Reset to page one/);
  fallbackFails = false; await run.owner.retryExecutables();
  assert.equal(run.state.executables.page.data[0].statistics_id, '1');
});

test('section denial/malformed data clears that section; execution-scoped 404 clears the whole view', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const failure of [new ApiError('http', { status: 403 }), new ApiError('invalid_response'),
    new ApiError('http', { status: 404 })]) {
    let failed = false;
    const run = setup(t, async resource => {
      if (!resource.endsWith('/executables')) return detailResponse('17');
      if (failed) throw failure;
      return executablePage();
    }, { autoRefresh: true });
    await run.owner.load(); await run.owner.toggleExecutables();
    failed = true; await run.owner.refresh();
    assert.equal(run.state.executables.page, null);
    assert.equal(run.state.response === null, failure.status === 404);
    assert.equal(run.state.poll.mode, 'blocked');
    const count = run.calls.length; t.mock.timers.tick(60000); await flush();
    assert.equal(run.calls.length, count);
    run.owner.dispose();
  }
});

test('a section deadline retains same-page data and disposal aborts its next request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let sections = 0, signal;
  const run = setup(t, (resource, options) => {
    if (!resource.endsWith('/executables')) return Promise.resolve(detailResponse('17'));
    if (++sections === 1) return Promise.resolve(executablePage());
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }, { timeoutMs: 1000 });
  await run.owner.load(); await run.owner.toggleExecutables();
  const work = run.owner.refresh(); await flush();
  t.mock.timers.tick(1000); await work;
  assert.equal(run.state.executables.error.kind, 'timeout');
  assert.equal(run.state.executables.stale, true);
  const next = run.owner.retryExecutables(); run.owner.dispose(); await next;
  assert.equal(signal.aborted, true);
});

test('base refresh failures gate sections and retain only transient same-execution observations', async t => {
  let failure = null;
  const run = setup(t, async resource => {
    if (resource.endsWith('/executables')) return executablePage();
    if (failure) throw failure;
    return detailResponse('17');
  });
  await run.owner.load(); await run.owner.toggleExecutables();
  failure = new ApiError('http', { status: 503 });
  const count = run.calls.length; await run.owner.refresh();
  assert.equal(run.calls.length, count + 1);
  assert.equal(run.state.executables.stale, true);
  assert.equal(run.state.stale, true);
  failure = new ApiError('http', { status: 403 }); await run.owner.refresh();
  assert.equal(run.state.response, null);
  assert.equal(run.state.executables.page, null);
});

test('closing a denied section restores the base-only polling schedule', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let denied = false;
  const run = setup(t, async resource => {
    if (!resource.endsWith('/executables')) return detailResponse('17');
    if (denied) throw new ApiError('http', { status: 403 });
    return executablePage();
  }, { autoRefresh: true, pollIntervalMs: 1000 });
  await run.owner.load(); await run.owner.toggleExecutables();
  denied = true; await run.owner.refresh();
  assert.equal(run.state.poll.mode, 'blocked');
  await run.owner.toggleExecutables();
  assert.equal(run.state.poll.mode, 'scheduled');
  const before = run.calls.length;
  t.mock.timers.tick(1000); await flush();
  assert.equal(run.calls.length, before + 1);
  assert.equal(run.calls.at(-1).resource, 'executions/17');
});

test('switching execution IDs rejects a previous section response, including an A to B to A path', async t => {
  const late = deferred(); let sections = 0;
  const run = setup(t, (resource) => {
    const id = resource.split('/')[1];
    return Promise.resolve(resource.endsWith('/executables') ? ++sections === 1 ? late.promise
      : executablePage([executable('1', { execution_id: id })]) : detailResponse(id));
  });
  await run.owner.load(); const old = run.owner.toggleExecutables();
  await run.owner.select('18'); await run.owner.select('17');
  const page = run.state.executables.page;
  late.resolve(executablePage([executable('9')])); await old;
  assert.equal(run.state.executables.page, page);
  assert.equal(page.data[0].execution_id, '17');
});

test('retained section checkpoints contain paths/query only and revalidate base before a saved page', async t => {
  const api = async (resource, { params }) => resource.endsWith('/executables')
    ? executablePage([executable(params.cursor ? '2' : '1')], { has_more: !params.cursor, next_cursor: params.cursor ? null : 'entry-A' })
    : detailResponse('17');
  const first = setup(t, api); await first.owner.load(); await first.owner.toggleExecutables(); await first.owner.nextExecutables();
  const saved = first.owner.checkpointExecutables();
  assert.doesNotMatch(JSON.stringify(saved), /execution_path|Task|statistics_id"\s*:/);
  first.owner.dispose();
  const returned = setup(t, api, { restoreExecutables: saved }); await returned.owner.load();
  assert.deepEqual(returned.calls.map(call => call.resource), ['executions/17', 'executions/17/executables']);
  assert.equal(returned.calls[1].params.cursor, 'entry-A');
  assert.equal(returned.state.executables.pageNumber, 2);
});
