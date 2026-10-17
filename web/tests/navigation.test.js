import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createNavigation, readNavigation } from '../src/navigation.js';
import { deferred, envelope, requestId } from './fixtures.js';

const folder = (id, name) => ({ folder_id: id, name, description: null });
const project = (id, name, parent = 'Exact + / 影狼') => ({ project_id: id, name, description: '',
  folder_id: '9007199254740993', folder_name: parent });
function page(rows, next = null, limit = 2) {
  return { ...envelope(rows), meta: { ...envelope().meta, limit, sort: 'name', direction: 'asc',
    from: null, to: null, has_more: next !== null, next_cursor: next } };
}

test('navigation validates identities and page metadata without rewriting exact names', () => {
  const rows = [folder('9007199254740993', '<b>影狼 + /</b>'), folder('9223372036854775807', 'all')];
  assert.equal(readNavigation(page(rows), 'folders', 2), rows);
  assert.equal(readNavigation(page([project('1', '  Exact  ')]), 'projects', 2)[0].name, '  Exact  ');
  for (const response of [page([folder(null, 'Null')]), page([folder(42, 'Numeric')]),
    page([folder('1', 'Same'), folder('1', 'Same')]), page([folder('1', 'x'.repeat(129))]),
    page([folder('1', 'OK')], ''), page([], 'cursor'), page([], null, 3),
    { ...page([]), meta: { ...page([]).meta, has_more: true, next_cursor: null } }]) {
    assert.throws(() => readNavigation(response, 'folders', 2), (error) => error.kind === 'invalid_response');
  }
});

test('choices fetch one bounded page on demand with opaque cursor history and no prefetch', async () => {
  const calls = [], states = [];
  const owner = createNavigation({ kind: 'folders', limit: 2, publish: (state) => states.push(state),
    api: { get: async (kind, options) => {
      calls.push({ kind, ...options.params });
      return options.params.cursor === null ? page([folder('1', 'A'), folder('2', 'B')], 'opaque+/=')
        : page([folder('3', 'C')]);
    } } });
  await owner.reset();
  assert.equal(calls.length, 1);
  assert.equal(states.at(-1).hasPrevious, false);
  assert.equal(states.at(-1).hasNext, true);
  await owner.next();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, 'opaque+/=');
  assert.equal(states.at(-1).page, 2);
  assert.deepEqual(states.at(-1).rows.map((row) => row.name), ['C']);
  await owner.next();
  assert.equal(calls.length, 2);
  await owner.previous();
  assert.equal(calls[2].cursor, null);
  assert.equal(states.at(-1).page, 1);
  assert.equal(calls.every((call) => call.limit === 2 && call.sort === 'name' && call.direction === 'asc'), true);
  owner.dispose();
});

test('projects require a folder for browsing, preserve literal names and expose empty scopes', async () => {
  const calls = [], states = [];
  const owner = createNavigation({ kind: 'projects', limit: 2, publish: (state) => states.push(state),
    api: { get: async (kind, options) => { calls.push(options.params); return page([]); } } });
  await owner.reset(null);
  assert.equal(calls.length, 0);
  assert.equal(states.at(-1).phase, 'idle');
  await owner.reset('all + / %_[影狼]');
  assert.equal(calls[0].folder, 'all + / %_[影狼]');
  assert.equal(states.at(-1).phase, 'ready');
  assert.equal(states.at(-1).hasNext, false);
  assert.deepEqual(states.at(-1).rows, []);
  owner.dispose();
});

test('changing folder aborts old navigation and ignores late success and failure', async () => {
  for (const fail of [false, true]) {
    const old = deferred(), current = deferred(), calls = [], states = [];
    const owner = createNavigation({ kind: 'projects', limit: 2, publish: (state) => states.push(state),
      api: { get: (kind, options) => { calls.push(options); return calls.length === 1 ? old.promise : current.promise; } } });
    const first = owner.reset('Old');
    const second = owner.reset('New');
    assert.equal(calls[0].signal.aborted, true);
    current.resolve(page([project('2', 'New project', 'New')]));
    await second;
    if (fail) old.reject(new ApiError('http', { status: 403 }));
    else old.resolve(page([project('1', 'Old project', 'Old')]));
    await first;
    assert.equal(states.at(-1).rows[0].name, 'New project');
    assert.deepEqual(states.map((state) => state.phase), ['loading', 'loading', 'ready']);
    owner.dispose();
  }
});

test('duplicate paging actions coalesce while a request is pending', async () => {
  const pending = deferred();
  let calls = 0;
  const owner = createNavigation({ kind: 'folders', limit: 2, publish: () => {},
    api: { get: () => { calls += 1; return pending.promise; } } });
  const first = owner.reset();
  await owner.next();
  await owner.previous();
  await owner.retry();
  assert.equal(calls, 1);
  pending.resolve(page([]));
  await first;
  owner.dispose();
});

test('an expired cursor stays failed until manual retry resets to page one', async () => {
  const calls = [], states = [];
  const owner = createNavigation({ kind: 'folders', limit: 2, publish: (state) => states.push(state),
    api: { get: async (kind, { params }) => {
      calls.push(params);
      if (params.cursor) throw new ApiError('http', { status: 400, code: 'cursor_expired', requestId });
      return page([folder('1', 'A')], 'old-cursor');
    } } });
  await owner.reset();
  await owner.next();
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).error.requestId, requestId);
  assert.equal(calls.length, 2);
  await owner.retry();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].cursor, null);
  assert.equal(states.at(-1).page, 1);
  owner.dispose();
});

test('denial clears choices, remains idle and supports an explicit retry', async () => {
  const states = [];
  let calls = 0;
  const owner = createNavigation({ kind: 'folders', limit: 2, publish: (state) => states.push(state),
    api: { get: async () => {
      if (++calls === 2) throw new ApiError('http', { status: 403, requestId });
      return page([folder('1', 'Protected')], 'next');
    } } });
  await owner.reset();
  await owner.next();
  assert.deepEqual(states.at(-1).rows, []);
  assert.equal(states.at(-1).hasNext, false);
  assert.equal(calls, 2);
  await owner.retry();
  assert.equal(calls, 3);
  assert.equal(states.at(-1).phase, 'ready');
  owner.dispose();
});

test('navigation deadline and disposal release requests and do not schedule retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = [];
  let signal, calls = 0;
  const owner = createNavigation({ kind: 'folders', limit: 2, publish: (state) => states.push(state),
    api: { get: (kind, options) => {
      calls += 1;
      signal = options.signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error()), { once: true }));
    } } });
  const pending = owner.reset();
  t.mock.timers.tick(15000);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(states.at(-1).error.kind, 'timeout');
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  owner.dispose();
  const late = deferred();
  const retired = createNavigation({ kind: 'folders', limit: 2, publish: (state) => states.push(state),
    api: { get: () => late.promise } });
  const previous = retired.reset();
  retired.dispose();
  const count = states.length;
  late.resolve(page([folder('1', 'Late')]));
  await previous;
  assert.equal(states.length, count);
});
