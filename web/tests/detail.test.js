import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDisplay } from '../src/display.js';
import { createDetailLoader, detailFields, readExecutionDetail } from '../src/detail.js';
import { deferred, metadata, requestId, wireTime } from './fixtures.js';
import { detailResponse } from './detail-fixture.js';

const id = '9223372036854775807';
const display = createDisplay({ timeZone: 'Europe/London', locale: 'en-GB' });

test('detail retains exact BIGINT/LSN/timestamps, zero durations/counts and literal names', () => {
  const response = detailResponse();
  response.data.folder_name = '<img onerror=alert(1)> 影狼\r\n+ /';
  response.data.project_lsn = id;
  const before = JSON.stringify(response);
  assert.equal(readExecutionDetail(response, id, display), response);
  const fields = detailFields(response, display);
  assert.equal(fields.folder, response.data.folder_name);
  assert.equal(fields.lsn, id);
  assert.equal(fields.environment, '—');
  assert.equal(fields.duration, '0 ms');
  assert.equal(fields.errors, '0');
  assert.equal(fields.logging, 'None');
  assert.equal(JSON.stringify(response), before);
});

test('created, active, incomplete and unknown observations have distinct projections', () => {
  const response = detailResponse();
  Object.assign(response.data, { started_at: null, ended_at: null, duration_seconds: null, elapsed_seconds: null,
    logging_level: null, project_lsn: null, status: { code: 2147483647, name: 'unknown' } });
  readExecutionDetail(response, id, display);
  let fields = detailFields(response, display);
  assert.equal(fields.duration, '—');
  assert.equal(fields.elapsed, '—');
  assert.equal(fields.logging, '—');
  assert.equal(fields.status, 'Unknown (2147483647)');
  Object.assign(response.data, { started_at: wireTime, elapsed_seconds: 0.0000001,
    logging_level: { code: -99, name: 'unknown' }, project_lsn: '0' });
  readExecutionDetail(response, id, display);
  fields = detailFields(response, display);
  assert.equal(fields.duration, '—');
  assert.equal(fields.elapsed, '<1 ms');
  assert.equal(fields.logging, 'Unknown (-99)');
  assert.equal(fields.lsn, '0');
});

test('wrong identity, malformed consumed fields and inconsistent counts fail with correlation', () => {
  const mutations = [
    r => { r.data.execution_id = '42'; }, r => { r.data.execution_id = 42; },
    r => { r.data.project_lsn = '00'; }, r => { r.data.project_lsn = '9223372036854775808'; },
    r => { r.data.environment = null; }, r => { r.data.environment.name = ''; },
    r => { r.data.folder_name = 'x'.repeat(129); }, r => { r.data.folder_name = '\ud800'; },
    r => { delete r.data.package_name; }, r => { r.data.status = null; },
    r => { r.data.logging_level = { code: 1.2, name: 'basic' }; },
    r => { r.data.created_at = null; }, r => { r.data.ended_at = '2026-02-30T00:00:00.0000000Z'; },
    r => { r.data.started_at = null; }, r => { r.data.ended_at = null; },
    r => { r.data.duration_seconds = -1; }, r => { r.data.elapsed_seconds = Infinity; },
    r => { r.data.warning_count = 0; }, r => { r.data.event_counts.all = 0; },
    r => { r.data.event_counts.duplicate_warnings = 2; },
    r => { r.data.event_counts.errors = null; }, r => { r.data.event_counts.all = 2 ** 53; },
    r => { r.meta.generated_at = null; },
  ];
  // End/start omission must contradict an actual observed duration to fail.
  for (const mutate of mutations) {
    const response = detailResponse();
    response.data.duration_seconds = response.data.elapsed_seconds = 1;
    mutate(response);
    assert.throws(() => readExecutionDetail(response, id, display), error =>
      error.kind === 'invalid_response' && error.requestId === requestId);
  }
  assert.throws(() => readExecutionDetail(null, id, display), error => error.kind === 'invalid_response');
});

test('one fixed-ID read coalesces activation and sends no overview or section selectors', async () => {
  const pending = deferred(), calls = [], states = [];
  const loader = createDetailLoader({ executionId: id, metadata: metadata(),
    api: { get: (...args) => { calls.push(args); return pending.promise; } }, publish: state => states.push(state) });
  const first = loader.load();
  await loader.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `executions/${id}`);
  assert.deepEqual(Object.keys(calls[0][1]), ['signal']);
  assert.equal(states.at(-1).response, null);
  pending.resolve(detailResponse());
  await first;
  assert.equal(states.at(-1).phase, 'ready');
  loader.dispose();
});

test('hidden and absent return the same empty unavailable state, then explicit retry recovers', async () => {
  for (const scenario of ['hidden', 'absent']) {
    let attempts = 0;
    const states = [];
    const loader = createDetailLoader({ executionId: id, metadata: metadata(),
      api: { async get() {
        if (++attempts === 1) throw new ApiError('http', { status: 404, requestId });
        return detailResponse();
      } }, publish: state => states.push(state) });
    await loader.load();
    assert.equal(states.at(-1).response, null, scenario);
    assert.equal(states.at(-1).error.message, 'The requested resource is unavailable.');
    await loader.load();
    assert.equal(states.at(-1).phase, 'ready');
    loader.dispose();
  }
});

test('deadline aborts one attempt; disposal ignores a late response and cancels the timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = [];
  let signal;
  const loader = createDetailLoader({ executionId: id, metadata: metadata(),
    api: { get: options => new Promise(() => options) }, publish: state => states.push(state) });
  loader.dispose();
  await loader.load();
  assert.equal(states.length, 0);
  const pending = deferred();
  const active = createDetailLoader({ executionId: id, metadata: metadata(),
    api: { get: (resource, options) => { signal = options.signal; return pending.promise; } },
    publish: state => states.push(state) });
  const request = active.load();
  t.mock.timers.tick(30000);
  assert.equal(signal.aborted, true);
  pending.resolve(detailResponse());
  await request;
  assert.equal(states.at(-1).error.kind, 'timeout');
  active.dispose();
  const late = deferred();
  const retired = createDetailLoader({ executionId: id, metadata: metadata(),
    api: { get: (resource, options) => { signal = options.signal; return late.promise; } },
    publish: state => states.push(state) });
  const work = retired.load();
  retired.dispose();
  assert.equal(signal.aborted, true);
  const count = states.length;
  late.resolve(detailResponse());
  await work;
  t.mock.timers.tick(60000);
  assert.equal(states.length, count);
});

test('invalid shell IDs never start transport', () => {
  const api = { get() { assert.fail('No request for invalid ID'); } };
  for (const executionId of [null, undefined, '0', '01', '-1', '1e3', 42, '9223372036854775808']) {
    assert.throws(() => createDetailLoader({ api, executionId, metadata: metadata(), publish() {} }));
  }
});
