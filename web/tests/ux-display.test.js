import assert from 'node:assert/strict';
import test from 'node:test';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executable, executablePage } from './executable-fixture.js';
import { child, childPage } from './child-fixture.js';
import { eventRow, eventPage } from './event-fixture.js';
import { historyMetadata, historyRow, historyPage, estimate } from './history-fixture.js';
import { wireTime } from './fixtures.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const stamp = cell => cell.children[1].firstChild;
const exact = (node, value, text) => {
  assert.equal(node.textContent, text);
  assert.equal(node.getAttribute('datetime'), value);
  assert.ok(node.title.includes(value));
};

test('detail observations use the execution date while history keeps creation and cross-day dates, exact attributes and compact status', async t => {
  const dom = detailDOM(), metadata = historyMetadata(), calls = [];
  metadata.capabilities.events = true; metadata.event_kinds = ['all'];
  const tomorrow = '2026-10-18T16:00:00.9876543Z';
  const responses = {
    executables: executablePage([executable('1'), executable('2', {started_at:tomorrow})]),
    children: childPage([child()]),
    events: eventPage([eventRow(), eventRow('2', {message_time:'2026-10-17T16:00:00.1240000Z'})]),
    history: historyPage([historyRow('17', {estimate:estimate()}),
      historyRow('16', {started_at:tomorrow, ended_at:tomorrow})]),
  };
  const screen = mountDetail(dom.root, {metadata, executionId:'17', appBase:'/app/',
    api:{async get(resource) { calls.push(resource); return responses[resource.split('/').at(-1)] ?? detailResponse('17'); }}});
  t.after(screen.dispose); await settle();
  for (const section of Object.keys(responses)) {
    dom.get(`${section}-toggle`).dispatchEvent(new Event('click')); await settle();
    const status = dom.get(`${section}-status`);
    assert.match(status.textContent, /^Page 1 ·/);
    assert.doesNotMatch(status.textContent, /Observed|Live results|Updated/);
    assert.ok(status.title.includes(wireTime));
    if (section === 'executables') {
      exact(stamp(dom.body.children[0].children[2].children[0]), wireTime, '17:00:00.123');
      exact(stamp(dom.body.children[1].children[2].children[0]), tomorrow, '2026-10-18 17:00:00.987');
    }
    if (section === 'children') exact(stamp(dom.childBody.children[0].children[1].children[0]), wireTime, '17:00:00.123');
    if (section === 'events') {
      exact(dom.eventBody.children[0].children[0].firstChild, wireTime, '17:00:00.123');
      exact(dom.eventBody.children[1].children[0].firstChild, '2026-10-17T16:00:00.1240000Z', '17:00:00.124');
      assert.equal(dom.get('events-kind').value, 'all');
    }
  }
  assert.equal(calls.length, 5, 'One base read and one lazy read for each selected tab');
  for (const [row, item] of responses.history.data.entries()) {
    for (const [index, key] of ['created_at','started_at','ended_at'].entries()) {
      const value = item[key];
      exact(dom.historyBody.children[row].children[index+1].firstChild, value,
        value === tomorrow ? '2026-10-18 17:00:00' : index === 0 ? '2026-10-17 17:00:00' : '17:00:00');
    }
  }
  exact(dom.historyBody.children[0].children[5].children[1].firstChild, wireTime, '17:00:00');
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(calls.length, 7, 'Refresh reads base detail and the active history tab only');
});

test('a newly recorded execution start updates cached table labels without replacing keyed rows', async t => {
  const dom = detailDOM(), metadata = historyMetadata();
  let started = false;
  const page = executablePage();
  const history = historyPage([historyRow('16', {estimate:estimate()})]);
  const screen = mountDetail(dom.root, {metadata, executionId:'17', appBase:'/app/', api:{async get(resource) {
    if (resource.endsWith('/executables')) return page;
    if (resource === 'history') return history;
    const response = detailResponse('17');
    Object.assign(response.data, {status:{code:2,name:'running'}, started_at:started ? wireTime : null,
      ended_at:null, duration_seconds:null, elapsed_seconds:started ? 0 : null});
    return response;
  }}});
  t.after(screen.dispose); await settle();
  dom.get('executables-toggle').dispatchEvent(new Event('click')); await settle();
  const row = dom.body.children[0];
  assert.equal(stamp(row.children[2].children[0]).textContent, '2026-10-17 17:00:00.123');
  started = true; dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(dom.body.children[0], row);
  exact(stamp(row.children[2].children[0]), wireTime, '17:00:00.123');
  dom.get('history-toggle').dispatchEvent(new Event('click')); await settle();
  const historicalRow = dom.historyBody.children[0];
  const historicalStart = historicalRow.children[2].firstChild;
  exact(historicalStart, wireTime, '17:00:00');
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(dom.historyBody.children[0], historicalRow);
  assert.equal(historicalRow.children[2].firstChild, historicalStart);
});
