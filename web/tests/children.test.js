import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { childQuery, readChildPage } from '../src/children.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, metadata, wireTime } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { child, childPage } from './child-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const query = { sort: 'started_at', direction: 'asc', limit: 50 };
const display = createDisplay({ timeZone: 'Europe/London' });
const resourcePage = resource => resource.endsWith('/children') ? childPage() : executablePage();
function setup(t, get, options = {}) {
  const states = [], calls = [];
  const owner = createDetailLoader({ executionId: '17', metadata: metadata(), autoRefresh: false, ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    publish: state => states.push(state) });
  t.after(() => owner.dispose());
  return { owner, calls, get state() { return states.at(-1); } };
}

test('child DTO preserves exact identities, pairing, seven-digit timing and unidentified coverage', () => {
  const page = childPage([child('9007199254740993', { source_name: '😀'.repeat(2000), source_type: -32768 }),
    child('9223372036854775807', { package_name: null, source_name: '', execution_path: '\\Parent\\' + '😀'.repeat(16376) })],
  { availability: 'unknown', has_unidentified_starts: true });
  assert.equal(readChildPage(page, '17', query, metadata(), display), page);
  const complete = childPage([child('1', { ended_at: wireTime, duration_seconds: 0, state: 'complete' })]);
  assert.equal(readChildPage(complete, '17', query, metadata(), display), complete);
  for (const mutate of [p => { p.data[0].observation_id = null; }, p => { p.data[0].execution_id = '18'; },
    p => { p.data[0].observation_id = p.data[1].observation_id; }, p => { p.meta.upper_id = '1'; },
    p => { p.data[0].package_name = ''; }, p => { p.data[0].source_name = '😀'.repeat(2001); },
    p => { p.data[0].execution_path = '\\Root'; }, p => { p.data[0].package_path = '\\Package '; },
    p => { p.data[0].source_type = 32768; }, p => { p.data[0].started_at = null; },
    p => { p.data[0].ended_at = wireTime; }, p => { p.data[0].duration_seconds = 0; },
    p => { p.data[0].state = 'succeeded'; }, p => { p.meta.has_unidentified_starts = null; },
    p => { p.meta.availability = 'available'; }, p => { p.meta.has_more = true; p.meta.next_cursor = ''; }]) {
    const bad = structuredClone(page); mutate(bad);
    assert.throws(() => readChildPage(bad, '17', query, metadata(), display), error => error.kind === 'invalid_response');
  }
  for (const changes of [{ ended_at: null }, { duration_seconds: null }, { ended_at: '2026-01-01T00:00:00.0000000Z' }]) {
    const bad = structuredClone(complete); Object.assign(bad.data[0], changes);
    assert.throws(() => readChildPage(bad, '17', query, metadata(), display));
  }
  for (const changes of [{ sort: 'statistics_id' }, { limit: 201 }, { direction: 'sideways' }]) {
    assert.throws(() => childQuery({ ...query, ...changes }, metadata()));
  }
});

test('two lazy sections retain independent page paths, orders and request budgets', async t => {
  const run = setup(t, async (resource, { params }) => resource.endsWith('/children')
    ? childPage([child(params.cursor ? '2' : '1')], { ...params, has_more: !params.cursor,
      next_cursor: params.cursor ? null : 'child-next' })
    : resource.endsWith('/executables') ? executablePage() : detailResponse('17'));
  await run.owner.load(); assert.equal(run.calls.length, 1);
  await run.owner.toggleExecutables(); await run.owner.toggleChildren(); await run.owner.nextChildren();
  assert.equal(run.state.children.pageNumber, 2); assert.equal(run.state.executables.pageNumber, 1);
  await run.owner.refresh();
  assert.deepEqual(run.calls.slice(-3).map(call => call.resource), ['executions/17', 'executions/17/executables', 'executions/17/children']);
  assert.equal(run.calls.at(-1).params.cursor, 'child-next');
  await run.owner.orderChildren({ sort: 'observation_id', direction: 'desc', limit: 1 });
  assert.equal(run.state.children.pageNumber, 1); assert.equal(run.calls.at(-1).params.cursor, undefined);
  assert.equal(run.state.executables.page.data.length, 1);
  await run.owner.toggleChildren(); await run.owner.refresh();
  assert.deepEqual(run.calls.slice(-2).map(call => call.resource), ['executions/17', 'executions/17/executables']);
});

test('opening a second section while busy queues it in the same serial cycle', async t => {
  const pending = deferred();
  const run = setup(t, resource => resource.endsWith('/executables') ? pending.promise
    : Promise.resolve(resource.endsWith('/children') ? childPage() : detailResponse('17')));
  await run.owner.load(); const opening = run.owner.toggleExecutables();
  await run.owner.toggleChildren(); assert.equal(run.calls.length, 2);
  pending.resolve(executablePage()); await opening;
  assert.equal(run.calls.length, 3); assert.equal(run.state.children.phase, 'ready');
});

test('closing an in-flight section preserves queued work and rejects its late execution denial', async t => {
  const pending = deferred(); let sections = 0;
  const current = setup(t, resource => resource === 'executions/17' ? Promise.resolve(detailResponse('17'))
    : resource.endsWith('/executables') && ++sections === 2 ? pending.promise : Promise.resolve(resourcePage(resource)));
  await current.owner.load(); await current.owner.toggleExecutables(); await current.owner.toggleChildren();
  const refresh = current.owner.refresh(); await flush();
  const signal = current.calls.at(-1).signal;
  await current.owner.toggleExecutables();
  assert.equal(signal.aborted, true); assert.equal(current.state.children.phase, 'ready');
  const page = current.state.children.page;
  pending.reject(new ApiError('http', { status: 404 })); await refresh;
  assert.equal(current.state.children.page, page); assert.notEqual(current.state.response, null);
});

test('section denial does not prevent other reads; closing it restores polling; child 404 clears both tables', async t => {
  let failure = null;
  const run = setup(t, async resource => resource === 'executions/17' ? detailResponse('17')
    : resource.endsWith('/children') && failure ? Promise.reject(failure) : resourcePage(resource), { autoRefresh: true });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren();
  failure = new ApiError('http', { status: 403 }); await run.owner.refresh();
  assert.equal(run.state.children.page, null); assert.notEqual(run.state.executables.page, null);
  assert.equal(run.state.poll.mode, 'blocked');
  await run.owner.toggleChildren(); assert.equal(run.state.poll.mode, 'scheduled');
  failure = null; await run.owner.toggleChildren();
  failure = new ApiError('http', { status: 404 }); await run.owner.refresh();
  assert.equal(run.state.response, null); assert.equal(run.state.children.page, null); assert.equal(run.state.executables.page, null);
});

test('transient child error retains its page; expired child reset failure cannot relabel it or reset executables', async t => {
  let failure = null, childCalls = 0;
  const run = setup(t, async (resource, { params }) => {
    if (resource === 'executions/17') return detailResponse('17');
    if (resource.endsWith('/executables')) return executablePage();
    childCalls++;
    if (failure) throw failure;
    return childPage([child(params.cursor ? '2' : '1')], { ...params, has_more: !params.cursor, next_cursor: params.cursor ? null : 'next' });
  });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren(); await run.owner.nextChildren();
  const old = run.state.children.page, executable = run.state.executables.page;
  failure = new ApiError('http', { status: 503 }); await run.owner.retryChildren();
  assert.equal(run.state.children.page, old); assert.equal(run.state.children.stale, true);
  const count = childCalls;
  failure = new ApiError('http', { status: 400, code: 'cursor_expired' }); await run.owner.retryChildren();
  assert.equal(childCalls, count + 2); assert.equal(run.state.children.page, null);
  assert.equal(run.state.children.pageNumber, 1); assert.match(run.state.children.notice, /Reset to page one/);
  assert.equal(run.state.executables.page, executable);
});

test('polling waits for both pages and coalesces manual and visible-return activation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = deferred(); let childCalls = 0;
  const run = setup(t, resource => resource === 'executions/17' ? Promise.resolve(detailResponse('17'))
    : resource.endsWith('/children') && ++childCalls === 2 ? pending.promise : Promise.resolve(resourcePage(resource)),
  { autoRefresh: true, pollIntervalMs: 1000 });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren();
  t.mock.timers.tick(1000); await flush(); const count = run.calls.length;
  run.owner.refresh(); run.owner.nextChildren(); run.owner.setVisible(false); run.owner.setVisible(true);
  t.mock.timers.tick(1000); await flush(); assert.equal(run.calls.length, count);
  pending.resolve(childPage()); await flush(); t.mock.timers.tick(0); await flush();
  assert.equal(run.calls.length, count + 3); assert.equal(run.state.busy, false);
});

test('child generations reject A to B to A late responses and disposal aborts the current page', async t => {
  const pending = deferred(); let calls = 0;
  const run = setup(t, resource => !resource.endsWith('/children') ? Promise.resolve(detailResponse(resource.split('/')[1]))
    : ++calls === 1 ? pending.promise : Promise.resolve(childPage([child('1', { execution_id: resource.split('/')[1] })])));
  await run.owner.load(); const old = run.owner.toggleChildren();
  await run.owner.select('18'); await run.owner.select('17');
  const current = run.state.children.page;
  pending.reject(new ApiError('http', { status: 404 })); await old;
  assert.equal(run.state.children.page, current); assert.equal(run.state.executionId, '17');
});

test('keyed child rendering updates incomplete pairs without result links, retaining paths and moved focus', async t => {
  const dom = detailDOM(), pending = deferred(); let calls = 0;
  const screen = mountDetail(dom.root, { executionId: '17', appBase: '/app/', metadata: metadata(),
    api: { get: async resource => resource.endsWith('/children') ? ++calls === 1
      ? childPage([child(), child('2')], { availability: 'unknown', has_unidentified_starts: true }) : pending.promise : detailResponse('17') } });
  t.after(() => screen.dispose()); await flush();
  dom.get('children-toggle').dispatchEvent(new Event('click')); await flush();
  const row = dom.childBody.firstChild, paths = row.children[0].children[2], summary = paths.firstChild;
  assert.equal(dom.childBody.children.length, 2); assert.match(row.textContent, /End unconfirmed/);
  assert.equal(row.children.length, 4);
  assert.equal(row.children[0].firstChild.textContent, 'Child.dtsx');
  assert.equal(row.children[0].children[1].textContent, 'Call path: Parent › Run[1] ');
  assert.equal(paths.children[1].children.at(-1).textContent, '\\Parent\\Run[1] ');
  assert.match(paths.textContent, /<b>Child 影狼<\/b>\r\nLine/);
  assert.equal(row.children[0].children[1].children.length, 0);
  assert.match(dom.get('children-status').textContent, /no public numeric ID/);
  assert.match(dom.get('children-status').textContent, /2 calls on this page/);
  assert.equal(row.children[1].children.length, 2);
  assert.equal(row.children[1].children[1].children[1].textContent, '—');
  paths.open = true; summary.focus(); dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  dom.get('legacy-detail-link').focus(); dom.get('children-scroll').scrollLeft = 180;
  pending.resolve(childPage([child('1', { ended_at: wireTime, duration_seconds: 0, state: 'complete' }), child('3')])); await flush();
  assert.equal(dom.childBody.firstChild, row); assert.equal(paths.open, true);
  assert.equal(dom.document.activeElement, dom.get('legacy-detail-link')); assert.equal(dom.get('children-scroll').scrollLeft, 180);
  assert.match(row.textContent, /Start\/end recorded/); assert.doesNotMatch(row.textContent, /Success|Succeeded|Executable ID/);
  assert.equal(row.children[3].firstChild.dataset.result, undefined);
  assert.equal(row.children[2].textContent, display.duration(0));
  assert.equal(row.children[1].children[1].children[1].firstChild.getAttribute('datetime'), wireTime);
});

test('visible call paths distinguish loops and tasks without merging repeated calls or claiming a total', async t => {
  const dom = detailDOM(), calls = [];
  const rows = [child('1', { execution_path: '\\Root\\Loop[1]\\Run\\Child' }),
    child('2', { execution_path: '\\Root\\Loop[2]\\Run\\Child' }),
    child('3', { execution_path: '\\Root\\ParallelB\\Child' }),
    child('4', { execution_path: '\\Root\\ParallelB\\Child', package_name: null, source_name: '', source_type: 0 })];
  const screen = mountDetail(dom.root, { executionId: '17', appBase: '/app/', metadata: metadata(),
    api: { get: async resource => { calls.push(resource); return resource.endsWith('/children')
      ? childPage(rows, { has_more: true, next_cursor: 'next' }) : detailResponse('17'); } } });
  t.after(() => screen.dispose()); await flush();
  assert.equal(calls.length, 1);
  dom.get('children-toggle').dispatchEvent(new Event('click')); await flush();
  assert.deepEqual(calls, ['executions/17', 'executions/17/children']);
  assert.equal(dom.childBody.children.length, 4);
  assert.deepEqual(dom.childBody.children.map(row => row.children[0].children[1].textContent), [
    'Call path: Root › Loop[1] › Run › Child', 'Call path: Root › Loop[2] › Run › Child',
    'Call path: Root › ParallelB › Child', 'Call path: Root › ParallelB › Child']);
  const missing = dom.childBody.children[3].children[0];
  assert.equal(missing.firstChild.textContent, '—');
  const details = missing.children[2].children[1];
  assert.equal(details.children[1].textContent, '4');
  assert.equal(details.children[3].textContent, '(empty)');
  assert.equal(details.children[5].textContent, '0');
  assert.match(dom.get('children-status').textContent, /4 calls on this page/);
  assert.equal(dom.get('children-next').getAttribute('aria-disabled'), 'false');
});

test('child view checkpoints restore anchors only after revalidation and clear coverage on disposal', async t => {
  const dom = detailDOM(), get = async resource => resource.endsWith('/children') ? childPage() : detailResponse('17');
  const options = { executionId: '17', appBase: '/app/', metadata: metadata(), api: { get } };
  const first = mountDetail(dom.root, options); await flush();
  dom.get('children-toggle').dispatchEvent(new Event('click')); await flush();
  const paths = dom.childBody.firstChild.children[0].children[2]; paths.open = true; paths.firstChild.focus();
  const saved = first.checkpoint(); first.dispose();
  assert.doesNotMatch(JSON.stringify(saved), /Child.dtsx|source_name|duration_seconds|影狼/);
  const second = mountDetail(dom.root, { ...options, restoreView: saved }); t.after(() => second.dispose()); await flush();
  assert.equal(dom.childBody.firstChild.children[0].children[2].open, true);
  second.dispose(); assert.equal(dom.childBody.children.length, 0); assert.equal(dom.get('children-status').textContent, '');
});

test('a child deadline retains only its prior page and releases the shared owner for retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let delayed = false;
  const run = setup(t, (resource, { signal }) => resource === 'executions/17' ? Promise.resolve(detailResponse('17'))
    : delayed && resource.endsWith('/children') ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new ApiError('network'))))
      : Promise.resolve(resourcePage(resource)), { timeoutMs: 20 });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren();
  const old = run.state.children.page;
  delayed = true; const refreshing = run.owner.refresh(); await flush();
  t.mock.timers.tick(20); await refreshing;
  assert.equal(run.state.children.page, old); assert.equal(run.state.children.error.kind, 'timeout');
  assert.equal(run.state.busy, false); assert.notEqual(run.state.executables.page, null);
  delayed = false; await run.owner.retryChildren(); assert.equal(run.state.children.error, null);
});

test('failure in one section does not skip the next, but a base denial gates and clears both', async t => {
  let failed = false, baseFailed = false;
  const run = setup(t, async resource => {
    if (resource === 'executions/17') {
      if (baseFailed) throw new ApiError('http', { status: 403 });
      return detailResponse('17');
    }
    if (resource.endsWith('/executables') && failed) throw new ApiError('http', { status: 403 });
    return resourcePage(resource);
  });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren();
  failed = true; await run.owner.refresh();
  assert.equal(run.state.executables.page, null); assert.equal(run.state.children.phase, 'ready');
  const count = run.calls.length; baseFailed = true; await run.owner.refresh();
  assert.equal(run.calls.length, count + 1); assert.equal(run.state.response, null);
  assert.equal(run.state.children.page, null); assert.equal(run.state.executables.page, null);
});

test('an empty child page still reports unidentified coverage and offers a focused error fallback', async t => {
  const dom = detailDOM(); let failure = false;
  const screen = mountDetail(dom.root, { executionId: '17', appBase: '/app/', metadata: metadata(),
    api: { get: async resource => {
      if (!resource.endsWith('/children')) return detailResponse('17');
      if (failure) throw new ApiError('invalid_response');
      return childPage([], { availability: 'unknown', has_unidentified_starts: true });
    } } });
  t.after(() => screen.dispose()); await flush(); dom.get('children-toggle').dispatchEvent(new Event('click')); await flush();
  assert.match(dom.childBody.textContent, /coverage is unknown/);
  assert.match(dom.get('children-status').textContent, /no public numeric ID/);
  failure = true; dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  assert.equal(dom.get('execution-detail').hidden, false); assert.doesNotMatch(dom.childBody.textContent, /Child.dtsx/);
});
