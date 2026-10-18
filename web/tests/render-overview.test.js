import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection } from '../src/selection.js';
import { deferred, envelope, metadata, wireTime } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';

const settings = metadata();
const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
const item = (id, changes = {}) => ({ execution_id: id, folder_name: '<b>影狼</b>', project_name: 'Project',
  package_name: 'Probe.dtsx', status: { code: 2, name: 'running' }, created_at: wireTime, started_at: wireTime,
  ended_at: null, duration_seconds: null, elapsed_seconds: 0, warning_count: 0, error_count: 0, ...changes });
const page = rows => ({ ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime,
  upper_id: '99', consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 50,
  has_more: false, next_cursor: null } });
const summary = () => ({ ...envelope({ total: 3, by_status: [{ code: 1, name: 'created', count: 0 },
  { code: 2, name: 'running', count: 3 }, { code: 4, name: 'failed', count: 0 }, { code: 7, name: 'succeeded', count: 0 }] }),
  meta: { ...envelope().meta, from, to, status_scope: 'all' } });

test('keyed rendering reuses rows and links, patches values, removes/adds/reorders and restores current focus/scroll', async () => {
  const dom = overviewDOM(), pending = deferred();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, executionBase: '/dashboard/execution/',
    api: { get: async resource => resource === 'executions' ? ++lists === 1
      ? page([item('3'), item('2'), item('1')]) : pending.promise : summary() } });
  await view.apply(defaultSelection(settings));
  const oldRows = [...dom.body.children], link = oldRows[1].children[0].firstChild;
  assert.equal(link.href, '/dashboard/execution/2');
  const refreshing = view.refresh();
  link.focus();
  dom.window.scrollX = 7;
  dom.window.scrollY = 250;
  dom.scroll.scrollLeft = 123;
  dom.scroll.scrollTop = 5;
  // Model a layout/scroll-anchor adjustment during DOM mutation. The renderer
  // must restore the position observed at completion, not at request start.
  dom.document.onMutation = () => {
    dom.window.scrollX = 0;
    dom.window.scrollY = 0;
    dom.scroll.scrollLeft = 0;
    dom.scroll.scrollTop = 0;
  };
  assert.equal(dom.body.children[1], oldRows[1]);
  pending.resolve(page([item('2', { warning_count: 9, elapsed_seconds: 1.2 }), item('4'), item('3')]));
  await refreshing;
  assert.deepEqual(dom.body.children.map(row => row.dataset.executionId), ['2', '4', '3']);
  assert.equal(dom.body.children[0], oldRows[1]);
  assert.equal(dom.body.children[0].children[0].firstChild, link);
  assert.equal(dom.body.children[0].children[7].textContent, '9');
  assert.match(dom.body.children[0].children[6].textContent, /Elapsed:/);
  assert.equal(oldRows[2].isConnected, false);
  assert.equal(dom.document.activeElement, link);
  assert.equal(dom.window.scrollX, 7);
  assert.equal(dom.window.scrollY, 250);
  assert.equal(dom.scroll.scrollLeft, 123);
  assert.equal(dom.scroll.scrollTop, 5);
  assert.match(dom.get('executions-status').textContent, /Updated/);
  assert.equal(dom.get('overview-refresh').attributes.get('aria-disabled'), 'false');
  view.dispose();
});

test('removing a focused execution moves focus to the table region; unchanged rows stay intact', async () => {
  const dom = overviewDOM(), pending = deferred();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, executionBase: '/execution/',
    api: { get: async resource => resource === 'executions' ? ++lists === 1
      ? page([item('3'), item('2')]) : pending.promise : summary() } });
  await view.apply(defaultSelection(settings));
  const retained = dom.body.children[0];
  dom.body.children[1].children[0].firstChild.focus();
  const refreshing = view.refresh();
  pending.resolve(page([item('3')]));
  await refreshing;
  assert.equal(dom.body.children[0], retained);
  assert.equal(dom.document.activeElement, dom.scroll);
  view.dispose();
});

test('transient refresh errors retain and label existing DOM; denial removes it and clears all counts', async () => {
  const dom = overviewDOM();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, executionBase: '/execution/',
    api: { get: async resource => {
      if (resource !== 'executions') return summary();
      if (++lists === 2) throw new ApiError('http', { status: 503 });
      if (lists === 3) throw new ApiError('http', { status: 403 });
      return page([item('3')]);
    } } });
  await view.apply(defaultSelection(settings));
  const row = dom.body.children[0];
  await view.refresh();
  assert.equal(dom.body.children[0], row);
  assert.match(dom.get('executions-status').textContent, /Previous results shown.*Updated/);
  assert.match(dom.get('summary-status').textContent, /Previous counts shown.*Updated/);
  assert.equal(dom.get('app-status').textContent, 'Refresh failed');
  await view.refresh();
  assert.equal(row.isConnected, false);
  assert.equal(dom.root.querySelector('[data-count="total"]').textContent, '—');
  assert.doesNotMatch(dom.get('executions-status').textContent, /Previous results shown/);
  assert.equal(dom.get('overview-refresh').disabled, false);
  view.dispose();
  assert.equal(dom.get('overview-refresh').disabled, true);
});

test('a browser-cache checkpoint retains only paths/view anchors and restores them after fresh requests', async () => {
  const dom = overviewDOM();
  const config = { metadata: settings, executionBase: '/execution/',
    api: { get: async resource => resource === 'executions' ? page([item('3'), item('2')]) : summary() } };
  const view = mountOverview(dom.root, config);
  await view.apply(defaultSelection(settings));
  dom.body.children[1].children[0].firstChild.focus();
  dom.window.scrollY = 240;
  dom.scroll.scrollLeft = 72;
  const saved = view.checkpoint();
  assert.equal(saved.view.focusId, '2');
  assert.doesNotMatch(JSON.stringify(saved), /package_name|elapsed_seconds|Probe/);
  view.dispose();
  dom.window.scrollY = 0;
  dom.scroll.scrollLeft = 0;
  const restored = mountOverview(dom.root, { ...config, retainedPaths: saved.paths, restoreView: saved.view });
  saved.paths.length = 0;
  await restored.apply(defaultSelection(settings), { restore: true });
  assert.equal(dom.document.activeElement, dom.body.children[1].children[0].firstChild);
  assert.equal(dom.window.scrollY, 240);
  assert.equal(dom.scroll.scrollLeft, 72);
  restored.dispose();
  dom.window.scrollY = 0;
  dom.scroll.scrollLeft = 0;
  const changed = mountOverview(dom.root, { ...config, restoreView: saved.view });
  await changed.apply({ ...defaultSelection(settings), folder: 'Different' }, { restore: true });
  assert.equal(dom.window.scrollY, 0, 'An unrelated URL selection must not restore the old view');
  assert.equal(dom.scroll.scrollLeft, 0);
  changed.dispose();
});
