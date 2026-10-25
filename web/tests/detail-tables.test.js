import assert from 'node:assert/strict';
import test from 'node:test';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { deferred } from './fixtures.js';
import { executable, executablePage } from './executable-fixture.js';
import { child, childPage } from './child-fixture.js';
import { eventMetadata, eventRow, eventPage } from './event-fixture.js';
import { parameterRow, parameterPage } from './parameter-fixture.js';
import { overrideRow, overridePage } from './override-fixture.js';
import { historyMetadata, historyPage } from './history-fixture.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const sections = ['executables', 'children', 'events', 'parameters', 'overrides', 'history'];
const bodies = { executables: 'body', children: 'childBody', events: 'eventBody', parameters: 'parameterBody', overrides: 'overrideBody', history: 'historyBody' };
function metadata() {
  const value = eventMetadata(); value.execution_statuses = historyMetadata().execution_statuses;
  value.capabilities.values = value.capabilities.override_values = true; return value;
}
function reply(resource, { params } = {}) {
  if (resource.endsWith('/executables')) return executablePage([executable('1', { execution_path: '<literal>\\'.repeat(500) })], params);
  if (resource.endsWith('/children')) return childPage([child('1', { execution_path: '<literal>\\'.repeat(500) })], params);
  if (resource.endsWith('/events')) return eventPage([eventRow('1', { message: '<literal>\n'.repeat(300) })], params);
  if (params?.section === 'parameters') return parameterPage([parameterRow('1', { value: '<literal>\n'.repeat(300) })], params);
  if (params?.section === 'overrides') return overridePage([overrideRow('1', { property_path: '<literal>\\'.repeat(300), value: '<literal>\n'.repeat(300) })], params);
  if (resource === 'history') return historyPage(undefined, params);
  return detailResponse('17');
}
function mount(t, tab, options = {}) {
  const dom = detailDOM(), calls = [], { get = reply, ...screenOptions } = options;
  dom.window.location.hash = `#${tab}`;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: '17', appBase: '/ops/app/', ...screenOptions,
    api: { async get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(() => screen.dispose());
  return { ...dom, calls, screen };
}

for (const [section, key, start] of [['executables', 'started_at', 'asc'], ['children', 'started_at', 'asc'],
  ['events', 'message_time', 'asc'], ['history', 'execution_id', 'desc']]) {
  test(`${section}: sortable headers send one supported server order and retain focused headers across refresh/return`, async t => {
    const run = mount(t, section); await settle();
    assert.equal(run.calls.length, 2);
    const header = run.get(`${section}-header-${key}`);
    assert.equal(header.parentElement.getAttribute('aria-sort'), start === 'asc' ? 'ascending' : 'descending');
    header.focus(); header.dispatchEvent(new Event('click')); await settle();
    assert.equal(run.calls.length, 3);
    assert.equal(run.calls.at(-1).params.sort, key);
    assert.equal(run.calls.at(-1).params.direction, start === 'asc' ? 'desc' : 'asc');
    assert.equal(run.document.activeElement, header);
    run.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
    assert.equal(run.calls.length, 5); assert.equal(run.document.activeElement, header);
    const saved = run.screen.checkpoint(); run.screen.dispose();
    const next = mount(t, section, { restoreView: saved }); await settle();
    assert.equal(next.calls.length, 2); assert.equal(next.document.activeElement, next.get(`${section}-header-${key}`));
    const count = next.calls.length, nextHeader = next.get(`${section}-header-${key}`);
    next.screen.dispose(); nextHeader.dispatchEvent(new Event('click'));
    assert.equal(next.calls.length, count);
  });
}

test('ID sorts without visible ID columns retain a readable combined sort choice and never claim another header is sorted', async t => {
  for (const [section, idKey, visibleKey] of [['events', 'event_id', 'message_time'], ['children', 'observation_id', 'started_at']]) {
    const run = mount(t, section); await settle();
    run.get(`${section}-sort`).value = `${idKey}:asc`; run.get(`${section}-sort`).dispatchEvent(new Event('change')); await settle();
    assert.equal(run.calls.length, 3); assert.equal(run.calls.at(-1).params.sort, idKey);
    assert.equal(run.get(`${section}-sort`).value, `${idKey}:asc`);
    assert.ok(run.get(`${section}-sort`).children.some(option => option.value === `${idKey}:asc` && /ID ↑/.test(option.textContent)));
    assert.equal(run.get(`${section}-header-${visibleKey}`).parentElement.getAttribute('aria-sort'), 'none');
  }
  const run = mount(t, 'executables'); await settle();
  run.get('executables-header-statistics_id').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.calls.at(-1).params.sort, 'statistics_id');
  assert.equal(run.get('executables-header-started_at').parentElement.getAttribute('aria-sort'), 'none');
});

for (const section of sections) test(`${section}: page-size select preserves an arbitrary restored limit within a smaller metadata maximum`, async t => {
  const first = mount(t, section); await settle(); const saved = first.screen.checkpoint(); first.screen.dispose();
  saved[section].query.limit = 37;
  const meta = metadata(); meta.limits.max_limit = 80;
  const run = mount(t, section, { metadata: meta, restoreView: saved }); await settle();
  const select = run.get(`${section}-limit`);
  assert.equal(select.tag, 'select'); assert.equal(select.value, '37');
  assert.deepEqual(select.children.map(node => node.value), ['25', '37', '50']);
  const options = [...select.children]; select.focus();
  run.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.deepEqual(select.children, options); assert.equal(run.document.activeElement, select);
  const before = run.calls.length; select.value = '25'; select.dispatchEvent(new Event('change')); await settle();
  assert.equal(run.calls.length, before + 1); assert.equal(run.calls.at(-1).params.limit, 25);
  if (['parameters', 'overrides'].includes(section)) {
    assert.deepEqual(run.calls.at(-1).params, { section, limit: 25 });
    assert.equal(run.get(`${section}-sort`).children.length, 0);
  }
});

function walk(node) { return [node, ...node.children.flatMap(walk)]; }
for (const section of sections.filter(key => key !== 'history')) test(`${section}: disclosures preserve cell structure, keyed nodes, bounded keyboard-scroll regions and open state`, async t => {
  const run = mount(t, section); await settle();
  const body = run[bodies[section]], row = body.firstChild, cells = [...row.children];
  const details = walk(row).filter(node => node.tag === 'details');
  assert.ok(details.length);
  const count = run.calls.length;
  for (const node of details) {
    const content = node.children[1];
    assert.match(content.className, /bounded-detail/); assert.equal(content.tabIndex, 0);
    assert.equal(content.getAttribute('role'), 'region'); assert.ok(content.getAttribute('aria-label'));
    node.open = true;
    assert.deepEqual(row.children, cells); node.open = false; assert.deepEqual(row.children, cells); node.open = true;
  }
  assert.equal(run.calls.length, count);
  details[0].firstChild.focus(); run.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.calls.length, count + 2); assert.equal(body.firstChild, row); assert.deepEqual(row.children, cells);
  assert.equal(run.document.activeElement, details[0].firstChild);
  assert.ok(details.every(node => node.open)); assert.match(row.textContent, /<literal>/);
  const content = details[0].children[1]; content.focus(); content.scrollTop = 40;
  run.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.document.activeElement, content); assert.equal(content.scrollTop, 40);
});

test('true flag chips update in place, distinguish System scope, and leave no flag disclosure or visible parameter ID', async t => {
  let updated = false;
  const get = (resource, options) => options.params?.section === 'parameters'
    ? parameterPage([parameterRow('1', { object_type: { code: 50, name: 'system' }, required: !updated, value_set: false, runtime_override: updated })], options.params)
    : reply(resource, options);
  const run = mount(t, 'parameters', { get }); await settle();
  const row = run.parameterBody.firstChild, chips = row.children[4].firstChild;
  const visible = () => chips.children.filter(node => !node.hidden).map(node => node.textContent);
  assert.deepEqual(visible(), ['Required']); assert.equal(row.dataset.scope, 'system');
  assert.equal(row.title, 'Parameter ID: 1'); assert.doesNotMatch(row.children[0].textContent, /ID:/);
  assert.equal(walk(chips).filter(node => node.tag === 'details').length, 0);
  updated = true; run.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.parameterBody.firstChild, row); assert.equal(row.children[4].firstChild, chips);
  assert.deepEqual(visible(), ['Runtime override']); assert.doesNotMatch(chips.textContent, /Required|Sensitive|Value set/);
});

test('busy order controls neither request nor relabel the page, while immediate category safely replaces pending event work', async t => {
  const wait = deferred(); let slow = false;
  const run = mount(t, 'events', { get: (resource, options) => resource.endsWith('/events') && slow && options.params.kind === 'all'
    ? wait.promise : reply(resource, options) }); await settle();
  slow = true; run.get('detail-refresh').dispatchEvent(new Event('click')); await settle(); const before = run.calls.length;
  run.get('events-header-message_time').dispatchEvent(new Event('click'));
  run.get('events-limit').value = '25'; run.get('events-limit').dispatchEvent(new Event('change'));
  assert.equal(run.calls.length, before); assert.equal(run.get('events-limit').value, '50');
  run.get('events-q').value = 'unapplied %_'; run.get('events-kind').value = 'errors';
  run.get('events-kind').dispatchEvent(new Event('change')); await settle();
  assert.equal(run.calls.length, before + 1); assert.equal(run.calls.at(-1).params.kind, 'errors');
  assert.equal(run.calls.at(-1).params.q, null); assert.equal(run.get('events-q').value, 'unapplied %_');
  assert.equal(run.calls[before - 1].signal.aborted, true);
  wait.resolve(reply('executions/17/events', { params: { limit: 50, sort: 'message_time', direction: 'asc' } })); await settle();
  assert.equal(run.get('events-kind').value, 'errors'); assert.equal(run.window.location.hash, '#events/errors');
});
