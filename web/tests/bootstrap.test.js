import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createMetadataLoader, readMetadata } from '../src/bootstrap.js';
import { deferred, envelope, metadata, requestId } from './fixtures.js';

test('metadata supplies limits, timezone, vocabulary and sorts without client defaults', () => {
  const custom = metadata();
  Object.assign(custom.limits, { default_limit: 25, max_limit: 100, default_range_hours: 48 });
  custom.display_timezone = 'Asia/Tokyo';
  custom.execution_sorts = ['created_at'];
  custom.execution_statuses = [{ code: 7, name: '<b>literal 影狼 + /</b>' }];
  const before = JSON.stringify(custom);
  assert.equal(readMetadata(custom), custom);
  assert.equal(custom.limits.default_limit, 25);
  assert.deepEqual(custom.execution_sorts, ['created_at']);
  assert.equal(JSON.stringify(custom), before);
});

test('invalid metadata is a correlated failure instead of invented settings', () => {
  const mutations = [
    (data) => { data.api_version = 'v2'; },
    (data) => { delete data.display_timezone; },
    (data) => { data.display_timezone = 'not/a/timezone'; },
    (data) => { delete data.limits.default_limit; },
    (data) => { data.limits.default_limit = 201; },
    (data) => { data.limits.default_range_hours = 745; },
    (data) => { data.limits.max_limit = '200'; },
    (data) => { delete data.limits.max_cursor_characters; },
    (data) => { data.limits.max_cursor_characters = 0; },
    (data) => { data.capabilities.events = 'false'; },
    (data) => { data.capabilities.override_values = true; },
    (data) => { data.execution_statuses = []; },
    (data) => { data.execution_statuses.push(data.execution_statuses[0]); },
    (data) => { data.execution_statuses = [null]; },
    (data) => { data.execution_sorts = ['execution_id', 'execution_id']; },
    (data) => { data.execution_sorts = [null]; },
  ];
  for (const mutate of mutations) {
    const data = metadata();
    mutate(data);
    assert.throws(() => readMetadata(data, requestId), (error) => {
      assert.equal(error.kind, 'invalid_metadata');
      assert.equal(error.requestId, requestId);
      return true;
    });
  }
  assert.throws(() => readMetadata(null), (error) => error.kind === 'invalid_metadata');
});

test('one bootstrap request owns repeated starts and releases its deadline after success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const states = [];
  let calls = 0, signal;
  const loader = createMetadataLoader({
    request: (options) => { calls += 1; signal = options.signal; return pending.promise; },
    publish: (state) => states.push(state),
  });
  const first = loader.load();
  await loader.load();
  await loader.load();
  assert.equal(calls, 1);
  assert.deepEqual(states.map((state) => state.phase), ['loading']);
  pending.resolve(envelope());
  await first;
  assert.deepEqual(states.map((state) => state.phase), ['loading', 'ready']);
  t.mock.timers.tick(60000);
  assert.equal(signal.aborted, false);
  assert.equal(calls, 1);
  loader.dispose();
});

test('failure stays idle until explicit retry, then uses the successful metadata', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const states = [];
  const loader = createMetadataLoader({
    request: async () => {
      calls += 1;
      if (calls === 1) throw new ApiError('http', { status: 503, requestId });
      const data = metadata();
      data.limits.default_limit = 25;
      return envelope(data);
    },
    publish: (state) => states.push(state),
  });
  await loader.load();
  assert.deepEqual(states.map((state) => state.phase), ['loading', 'error']);
  assert.equal(states.at(-1).metadata, null);
  assert.equal(states.at(-1).error.requestId, requestId);
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  await loader.load();
  assert.equal(calls, 2);
  assert.equal(states.at(-1).phase, 'ready');
  assert.equal(states.at(-1).metadata.limits.default_limit, 25);
  loader.dispose();
});

test('bad settings report their request ID and keep configuration absent', async () => {
  const data = metadata();
  data.execution_sorts = [];
  const states = [];
  const loader = createMetadataLoader({ request: async () => envelope(data), publish: (state) => states.push(state) });
  await loader.load();
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).metadata, null);
  assert.equal(states.at(-1).error.kind, 'invalid_metadata');
  assert.equal(states.at(-1).error.requestId, requestId);
  loader.dispose();
});

test('deadline aborts the request and offers one retry without automatic rescheduling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = [];
  let signal, calls = 0;
  const loader = createMetadataLoader({
    request: (options) => {
      calls += 1;
      signal = options.signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true }));
    },
    publish: (state) => states.push(state),
  });
  const pending = loader.load();
  t.mock.timers.tick(10000);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).error.kind, 'timeout');
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  assert.equal(states.length, 2);
  loader.dispose();
});

test('disposed loader ignores late completion even if transport ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldRequest = deferred();
  const states = [];
  let oldSignal;
  const retired = createMetadataLoader({
    request: ({ signal }) => { oldSignal = signal; return oldRequest.promise; },
    publish: (state) => states.push(state),
  });
  const late = retired.load();
  retired.dispose();
  assert.equal(oldSignal.aborted, true);
  const latest = metadata();
  latest.display_timezone = 'Asia/Tokyo';
  const current = createMetadataLoader({ request: async () => envelope(latest), publish: (state) => states.push(state) });
  await current.load();
  oldRequest.resolve(envelope());
  await late;
  await retired.load();
  t.mock.timers.tick(60000);
  assert.deepEqual(states.map((state) => state.phase), ['loading', 'loading', 'ready']);
  assert.equal(states.at(-1).metadata.display_timezone, 'Asia/Tokyo');
  current.dispose();
});
