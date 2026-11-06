import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDisplay } from '../src/display.js';
import { mountDetail } from '../src/render-detail.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executable, executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { metadata } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';
import { overviewPage, timelineMetadata, timelineSummary } from './timeline-fixture.js';

// UX review 2026-11-05, batch B4: shell, refresh controls, time display and executable density.
const flush = () => new Promise(resolve => setImmediate(resolve));
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function detail(t, response, executables = () => executablePage()) {
  const dom = detailDOM();
  dom.window.location.hash = '#executables';
  const view = mountDetail(dom.root, { metadata: metadata(), executionId: '17', appBase: '/app/', api: {
    async get(resource) {
      return resource.endsWith('/executables') ? executables() : resource.endsWith('/children') ? childPage() : response;
    } } });
  t.after(view.dispose);
  return dom;
}

test('G2: the tab title names package, run and status; a favicon is linked and emitted', async t => {
  const dom = detail(t, detailResponse('17'));
  await flush(); await flush();
  assert.equal(dom.document.title, 'Main.dtsx #17 · Succeeded · SSIS Dashboard');
  assert.match(source('../../dashboard/templates/app/base.html'), /<link rel="icon" type="image\/svg\+xml" href="{{ assets\.icon }}">/);
  assert.match(source('../vite.config.js'), /fileName: 'favicon\.svg'/);
  assert.match(source('../src/favicon.svg'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('G3: an ended execution hides Pause and says when it was read; a running one keeps it', async t => {
  const ended = detail(t, detailResponse('17'));
  await flush(); await flush();
  assert.equal(ended.get('detail-poll-toggle').hidden, true);
  assert.equal(ended.get('detail-poll-status').textContent, 'Execution ended · updated 17:00:00');
  const running = detail(t, runningDetailResponse('17'));
  await flush(); await flush();
  assert.equal(running.get('detail-poll-toggle').hidden, false);
});

test('G4: whole-second table times drop ".000"; any nonzero fraction keeps it', () => {
  const display = createDisplay({ timeZone: 'Europe/London' });
  const start = '2026-10-18T23:00:00.0000000Z';
  assert.equal(display.tableTimestamp('2026-10-18T23:05:00.0000000Z', start), '00:05:00');
  assert.equal(display.tableTimestamp('2026-10-18T23:05:00.0000001Z', start), '00:05:00.000');
  assert.equal(display.tableTimestamp('2026-10-18T23:05:00.1230000Z', start), '00:05:00.123');
});

test('G4: overview Started shows only its time on the Created date, keeping the full value in title', async t => {
  const settings = timelineMetadata(), dom = overviewDOM();
  const sameDay = { ...overviewPage().data[0], execution_id: '2', created_at: '2026-10-17T10:00:00.0000000Z',
    started_at: '2026-10-17T10:00:34.0000000Z' };
  const nextDay = { ...sameDay, execution_id: '1', created_at: '2026-10-17T22:59:00.0000000Z',
    started_at: '2026-10-17T23:00:30.0000000Z' };
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/', api: { async get(resource) {
    const bounds = { from: '2026-10-17T00:00:00.0000000Z', to: '2026-10-18T00:00:00.0000000Z' };
    return resource === 'executions' ? { ...overviewPage(bounds), data: [sameDay, nextDay] } : timelineSummary(bounds);
  } } });
  t.after(view.dispose);
  await view.apply(validateSelection(defaultSelection(settings), settings));
  const [first, second] = dom.body.children.map(row => row.children[5].firstChild);
  assert.equal(first.textContent, '11:00:34');
  assert.equal(first.title, '2026-10-17 11:00:34 · 2026-10-17T10:00:34.0000000Z');
  assert.equal(second.textContent, '2026-10-18 00:00:30', 'a run that starts after midnight keeps its date');
  assert.equal(dom.body.children[0].children[4].firstChild.textContent, '2026-10-17 11:00:00');
});

test('D4: executable rows name their parent container, and the package only for child packages', async t => {
  const dom = detail(t, detailResponse('17'), () => executablePage([
    executable('3', { execution_path: '\\Main', name: 'Main' }),
    executable('2', { execution_path: '\\Main\\Load City Dimension\\Get Lineage Key', name: 'Get Lineage Key' }),
    executable('1', { execution_path: '\\Main\\Run Child\\Probe\\ProbeWork', name: 'ProbeWork', package_name: 'Probe.dtsx' })]));
  await flush(); await flush();
  const lines = dom.body.children.map(row => row.children[1].children[1].textContent);
  assert.deepEqual(lines, ['', 'in Load City Dimension', 'in Probe · package Probe.dtsx']);
  assert.ok(dom.body.children.every(row => !/Executable ID: /.test(row.children[1].children[1].textContent)));
});

// Codex review round 1 (2026-11-05) regressions.
test('R1-1: a NULL execution path renders a row without a parent line instead of clearing the page', async t => {
  const dom = detail(t, detailResponse('17'), () => executablePage([executable('1', { execution_path: null })]));
  await flush(); await flush();
  assert.equal(dom.body.children.length, 1);
  assert.equal(dom.body.children[0].children[1].children[1].textContent, '');
  assert.equal(dom.get('execution-detail').hidden, false);
});

test('R1-2: denial and disposal reset the tab title to the bare execution ID', async t => {
  let denied = false;
  const dom = detailDOM();
  const view = mountDetail(dom.root, { metadata: metadata(), executionId: '17', appBase: '/app/', api: {
    async get(resource) {
      if (denied) throw new ApiError('http', { status: 403 });
      return resource.endsWith('/executables') ? executablePage() : resource.endsWith('/children') ? childPage() : detailResponse('17');
    } } });
  await flush(); await flush();
  assert.match(dom.document.title, /^Main\.dtsx #17/);
  denied = true;
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.document.title, 'Execution 17 · SSIS Dashboard');
  denied = false;
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.match(dom.document.title, /^Main\.dtsx #17/);
  view.dispose();
  assert.equal(dom.document.title, 'Execution 17 · SSIS Dashboard');
});
