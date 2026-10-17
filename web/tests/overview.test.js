import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDisplay } from '../src/display.js';
import { createOverview, readExecutionPage, readSummary } from '../src/overview.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { deferred, envelope, metadata, requestId, wireTime } from './fixtures.js';

const settings = metadata();
settings.execution_statuses = [{ code: 1, name: 'created' }, { code: 2, name: 'running' },
  { code: 4, name: 'failed' }, { code: 7, name: 'succeeded' }];
const display = createDisplay({ timeZone: settings.display_timezone, locale: 'en-GB' });
const selection = (changes = {}) => validateSelection({ ...defaultSelection(settings), ...changes }, settings);
const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
const row = (changes = {}) => ({ execution_id: '9007199254740993', folder_name: '<b>影狼 + /</b>',
  project_name: 'all', package_name: 'Probe.dtsx', status: { code: 2, name: 'running' },
  created_at: '2026-10-17T12:00:00.1234567Z', started_at: '2026-10-17T12:00:01.1234567Z',
  ended_at: null, duration_seconds: null, elapsed_seconds: 0.0000001, warning_count: 0, error_count: 1, ...changes });
function page(rows = [row()], changes = {}) {
  return { ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime,
    limit: 50, sort: 'execution_id', direction: 'desc', has_more: false, next_cursor: null, ...changes } };
}
function summary(changes = {}, meta = {}) {
  return { ...envelope({ total: 10, by_status: [{ code: 1, name: 'created', count: 0 },
    { code: 2, name: 'running', count: 1 }, { code: 4, name: 'failed', count: 2 },
    { code: 7, name: 'succeeded', count: 3 }, { code: 42, name: 'unknown', count: 4 }], ...changes }),
  meta: { ...envelope().meta, from, to, status_scope: 'all', ...meta } };
}
const setup = (get) => {
  const states = [];
  return { states, owner: createOverview({ api: { get }, metadata: settings,
    publish: (state) => states.push(state), locale: 'en-GB' }) };
};

test('list establishes exact bounds before all-status summary, without changing wire data', async () => {
  const calls = [], response = page(), before = JSON.stringify(response);
  const { owner, states } = setup(async (resource, options) => {
    calls.push({ resource, ...options });
    return resource === 'executions' ? response : summary();
  });
  await owner.apply(selection({ status: [2], folder: 'all + / 影狼' }));
  assert.deepEqual(calls.map((call) => call.resource), ['executions', 'metrics/summary']);
  assert.equal(calls[0].params.status, '2');
  assert.deepEqual(calls[1].params, { folder: 'all + / 影狼', project: null, from, to });
  assert.equal('status' in calls[1].params, false);
  assert.equal(JSON.stringify(response), before);
  assert.deepEqual(states.map((state) => state.phase), ['loading-list', 'loading-summary', 'ready']);
  assert.equal(states.at(-1).page.data.length, 1);
  assert.equal(states.at(-1).summary.data.total, 10);
  owner.dispose();
});

test('an empty selected-status list still requests the all-status cohort summary', async () => {
  const calls = [];
  const { owner, states } = setup(async (resource) => { calls.push(resource); return resource === 'executions' ? page([]) : summary(); });
  await owner.apply(selection({ status: [7] }));
  assert.equal(states.at(-1).page.data.length, 0);
  assert.equal(states.at(-1).summary.data.total, 10);
  assert.equal(calls.length, 2);
  owner.dispose();
});

test('typed rows retain BIGINT, literal text, unknown codes, NULL observations and zero', () => {
  const rows = [row({ execution_id: '9223372036854775807', folder_name: '😀'.repeat(64),
    package_name: 'a'.repeat(260), status: { code: 42, name: 'unknown' } }),
  row({ execution_id: '2', started_at: null, ended_at: null, elapsed_seconds: null,
    status: { code: 1, name: 'created' }, warning_count: 0, error_count: 0 }),
  row({ execution_id: '3', ended_at: '2026-10-17T12:00:01.1234567Z', duration_seconds: 0, elapsed_seconds: 0 })];
  const result = page(rows);
  assert.equal(readExecutionPage(result, selection(), settings, display), result);
  assert.equal(result.data[0].execution_id, '9223372036854775807');
  assert.equal(result.data[1].duration_seconds, null);
  assert.equal(result.data[2].duration_seconds, 0);
});

test('malformed rows and mismatched cohort/order metadata fail with a safe request ID', () => {
  const invalid = [page([row({ execution_id: 42 })]), page([row(), row()]),
    page([row({ status: null })]), page([row({ created_at: to })]), page([row({ created_at: null })]),
    page([row({ warning_count: null })]), page([row({ elapsed_seconds: -1 })]),
    page([row({ started_at: null, elapsed_seconds: 0 })]), page([row({ duration_seconds: 0 })]),
    page([row({ folder_name: '' })]), page([], { limit: 25 }), page([], { sort: 'created_at' }),
    page([], { direction: 'asc' }), page([], { to: from }), page([], { next_cursor: 'unexpected' }),
    page([], { has_more: true, next_cursor: 'opaque' })];
  for (const response of invalid) {
    assert.throws(() => readExecutionPage(response, selection(), settings, display), (error) =>
      error.kind === 'invalid_response' && error.requestId === requestId);
  }
  assert.throws(() => readExecutionPage(page(), selection({ status: [7] }), settings, display), ApiError);
  assert.throws(() => readExecutionPage(page(), selection({ from: '2026-10-17T00:00:00.0000002Z' }), settings, display), ApiError);
  assert.equal(readExecutionPage(page(), selection({ from: '2026-10-17T01:00:00.0000001+01:00' }), settings, display).meta.from, from);
});

test('summary validates exact bounds, all scope, known zeros, unknown counts and safe totals', () => {
  const response = summary();
  assert.equal(readSummary(response, page(), settings, display), response);
  for (const invalid of [summary({ total: 9 }), summary({ total: null }),
    summary({}, { from: '2026-10-17T00:00:00.0000002Z' }), summary({}, { status_scope: 'selected' }),
    summary({ by_status: response.data.by_status.slice(1) }),
    summary({ by_status: [...response.data.by_status, response.data.by_status[0]] }),
    summary({ by_status: response.data.by_status.map((item) => ({ ...item, count: '0' })) })]) {
    assert.throws(() => readSummary(invalid, page(), settings, display), ApiError);
  }
});

test('list failure issues no summary and waits for a manual retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const { owner, states } = setup(async (resource) => {
    calls.push(resource);
    if (calls.length === 1) throw new ApiError('http', { status: 503, requestId });
    return resource === 'executions' ? page() : summary();
  });
  await owner.apply(selection());
  assert.equal(states.at(-1).phase, 'list-error');
  assert.equal(states.at(-1).page, null);
  t.mock.timers.tick(60000);
  assert.deepEqual(calls, ['executions']);
  await owner.retryList();
  assert.deepEqual(calls, ['executions', 'executions', 'metrics/summary']);
  assert.equal(states.at(-1).phase, 'ready');
  owner.dispose();
});

test('summary failure retains current rows and retries only the exact summary request', async () => {
  const calls = [];
  const { owner, states } = setup(async (resource, { params }) => {
    calls.push({ resource, params });
    if (calls.length === 2) throw new ApiError('http', { status: 503, requestId });
    return resource === 'executions' ? page() : summary();
  });
  await owner.apply(selection());
  const retained = states.at(-1).page;
  assert.equal(states.at(-1).phase, 'summary-error');
  assert.equal(states.at(-1).summary, null);
  await owner.retrySummary();
  assert.equal(states.at(-1).page, retained);
  assert.equal(states.at(-1).phase, 'ready');
  assert.deepEqual(calls.map((call) => call.resource), ['executions', 'metrics/summary', 'metrics/summary']);
  assert.deepEqual(calls[1].params, calls[2].params);
  owner.dispose();
});

test('denied summary access clears rows and cards and requires an execution retry', async () => {
  const { owner, states } = setup(async (resource) => {
    if (resource !== 'executions') throw new ApiError('http', { status: 403, requestId });
    return page();
  });
  await owner.apply(selection());
  assert.equal(states.at(-1).phase, 'list-error');
  assert.equal(states.at(-1).page, null);
  assert.equal(states.at(-1).summary, null);
  assert.equal(states.at(-1).error.status, 403);
  owner.dispose();
});

test('new selection cancels old list and ignores late success or failure', async () => {
  for (const reject of [false, true]) {
    const old = deferred(), current = deferred(), calls = [];
    const { owner, states } = setup((resource, options) => {
      calls.push({ resource, ...options });
      if (resource !== 'executions') return Promise.resolve(summary());
      return options.params.folder === 'Old' ? old.promise : current.promise;
    });
    const first = owner.apply(selection({ folder: 'Old' }));
    const second = owner.apply(selection({ folder: 'New' }));
    assert.equal(calls[0].signal.aborted, true);
    current.resolve(page());
    await second;
    if (reject) old.reject(new ApiError('http', { status: 403 }));
    else old.resolve(page());
    await first;
    assert.equal(states.at(-1).selection.folder, 'New');
    assert.equal(states.at(-1).phase, 'ready');
    assert.equal(calls.filter((call) => call.resource === 'metrics/summary').length, 1);
    owner.dispose();
  }
});

test('a retired summary cannot replace or deny a newer cohort', async () => {
  const pending = deferred();
  let summaryCount = 0, oldSignal;
  const { owner, states } = setup(async (resource, options) => {
    if (resource === 'executions') return page();
    if (++summaryCount === 1) { oldSignal = options.signal; return pending.promise; }
    return summary();
  });
  const first = owner.apply(selection({ folder: 'Old' }));
  while (!oldSignal) await Promise.resolve();
  await owner.apply(selection({ folder: 'New' }));
  assert.equal(oldSignal.aborted, true);
  pending.reject(new ApiError('http', { status: 403 }));
  await first;
  assert.equal(states.at(-1).selection.folder, 'New');
  assert.equal(states.at(-1).phase, 'ready');
  owner.dispose();
});

test('invalid selection and disposal clear data, cancel work and ignore late results', async () => {
  const pending = deferred();
  let signal;
  const { owner, states } = setup((resource, options) => { signal = options.signal; return pending.promise; });
  const first = owner.apply(selection());
  await owner.apply(null);
  assert.equal(signal.aborted, true);
  assert.equal(states.at(-1).phase, 'idle');
  assert.equal(states.at(-1).page, null);
  owner.dispose();
  const length = states.length;
  owner.dispose();
  pending.resolve(page());
  await first;
  await owner.apply(selection());
  assert.equal(states.length, length);
});

test('deadline stops the current request without retry loops and duplicate apply coalesces', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  const { owner, states } = setup((resource, options) => {
    calls += 1;
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const first = owner.apply(selection());
  await owner.apply(selection());
  await owner.retryList();
  assert.equal(calls, 1);
  t.mock.timers.tick(30000);
  await first;
  assert.equal(signal.aborted, true);
  assert.equal(states.at(-1).error.kind, 'timeout');
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  owner.dispose();
});
