import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { deferred } from './fixtures.js';
import { runningDetailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';
import { parameterPage } from './parameter-fixture.js';
import { overridePage } from './override-fixture.js';
import { historyMetadata, historyPage } from './history-fixture.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const tabs = ['events', 'children', 'parameters', 'overrides', 'history', 'executables'];
function settings() {
  const metadata = historyMetadata();
  metadata.capabilities.events = metadata.capabilities.values = metadata.capabilities.override_values = true;
  metadata.event_kinds = eventMetadata().event_kinds;
  return metadata;
}

function reply(resource, params = {}) {
  const id = resource.split('/')[1];
  if (/^executions\/\d+$/.test(resource)) return runningDetailResponse(id);
  const page = resource.endsWith('/events') ? eventPage(undefined, params)
    : resource.endsWith('/children') ? childPage(undefined, params)
      : resource.endsWith('/executables') ? executablePage(undefined, params)
        : params.section === 'parameters' ? parameterPage(undefined, params)
          : params.section === 'overrides' ? overridePage(undefined, params) : historyPage(undefined, params);
  if (resource.startsWith('executions/')) for (const row of page.data) row.execution_id = id;
  return page;
}

test('repeated rapid ID/tab replacements reject late successes and denials, then dispose the timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = [], actions = [], states = [];
  let hold = false, calls = 0, peak = 0;
  const owner = createDetailLoader({ metadata: settings(), executionId: '17', publish: state => states.push(state),
    api: { get(resource, { params, signal }) {
      calls += 1;
      if (!hold || /^executions\/\d+$/.test(resource)) return Promise.resolve(reply(resource, params));
      const late = deferred();
      pending.push({ resource, params, signal, late });
      peak = Math.max(peak, pending.filter(item => !item.signal.aborted).length);
      // Deliberately ignore abort: a late transport must still lose publication rights.
      return late.promise;
    } } });
  t.after(owner.dispose);
  await owner.load();
  hold = true;
  for (let round = 0; round < 24; round += 1) {
    actions.push(owner.select(round % 2 ? '17' : '18'));
    await settle();
    for (const tab of tabs) actions.push(owner.selectTab({ tab }));
  }
  assert.ok(pending.length >= 144);
  assert.equal(peak, 1);
  const current = pending.at(-1);
  for (const [index, item] of pending.slice(0, -1).entries()) {
    assert.equal(item.signal.aborted, true);
    if (index % 2) item.late.reject(new ApiError('http', { status: 403 }));
    else item.late.resolve(reply(item.resource, item.params));
  }
  current.late.resolve(reply(current.resource, current.params));
  await Promise.all(actions);
  const state = states.at(-1);
  assert.equal(state.executionId, '17');
  assert.equal(state.response.data.execution_id, '17');
  assert.equal(state.activeTab, 'executables');
  assert.equal(state.executables.page.data[0].execution_id, '17');
  assert.equal(state.phase, 'ready');
  assert.equal(state.error, null);
  assert.equal(state.poll.mode, 'scheduled');
  owner.dispose();
  const finalCalls = calls, finalPublications = states.length;
  t.mock.timers.tick(600000);
  await settle();
  assert.equal(calls, finalCalls);
  assert.equal(states.length, finalPublications);
});

test('three screens refresh maximum-text continuation pages with one request each and drain on disposal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const maximum = '😀'.repeat(16384), paths = '界'.repeat(16384), source = '界'.repeat(4000);
  const runs = Array.from({ length: 3 }, () => ({ active: 0, peak: 0, calls: [], states: [] }));
  let active = 0, peak = 0;
  for (const run of runs) {
    run.owner = createDetailLoader({ executionId: '17', metadata: settings(), initialTab: { tab: 'events' },
      publish: state => run.states.push(state), api: { async get(resource, { params, signal }) {
        run.calls.push({ resource, params, signal });
        run.active += 1; active += 1;
        run.peak = Math.max(run.peak, run.active); peak = Math.max(peak, active);
        try {
          await settle();
          if (!resource.endsWith('/events')) return runningDetailResponse('17');
          const second = params.cursor === 'second';
          const rows = Array.from({ length: params.limit }, (_, index) => eventRow(String(index + (second ? 201 : 1)), {
            message: maximum, truncated: true, package_path: paths, execution_path: paths,
            source_name: source, subcomponent_name: source,
          }));
          return eventPage(rows, { ...params, upper_id: '400', has_more: !second, next_cursor: second ? null : 'second' });
        } finally { run.active -= 1; active -= 1; }
      } } });
    t.after(run.owner.dispose);
  }
  await Promise.all(runs.map(run => run.owner.load()));
  await Promise.all(runs.map(run => run.owner.section('events').order({ limit: 200 })));
  for (let round = 0; round < 8; round += 1) {
    await Promise.all(runs.map(run => run.owner.section('events').next()));
    await Promise.all(runs.map(run => run.owner.refresh()));
    for (const run of runs) {
      const state = run.states.at(-1);
      assert.equal(state.events.page.data.length, 200);
      assert.equal(state.events.page.data[0].event_id, '201');
      assert.equal(run.calls.at(-1).params.cursor, 'second');
      assert.equal(state.events.error, null);
    }
  }
  assert.equal(peak, 3);
  assert.equal(active, 0);
  for (const run of runs) {
    assert.equal(run.peak, 1);
    assert.equal(run.active, 0);
    run.owner.dispose();
  }
  const finalCalls = runs.map(run => run.calls.length);
  t.mock.timers.tick(600000);
  await settle();
  assert.deepEqual(runs.map(run => run.calls.length), finalCalls);
});
