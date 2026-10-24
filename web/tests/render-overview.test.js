import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountOverview } from '../src/render-overview.js';
import { mountDetail } from '../src/render-detail.js';
import { defaultSelection, parseSelection } from '../src/selection.js';
import { deferred, envelope, metadata, wireTime } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { overviewDOM } from './overview-dom.js';
import { executable, executablePage } from './executable-fixture.js';

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

for (const control of ['previous', 'next', 'latest']) {
  test(`automatic refresh preserves ${control} focus, blocks busy paging and respects later focus movement`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const dom = overviewDOM(), pendingList = deferred(), pendingSummary = deferred();
    const calls = [];
    let delayed = false;
    const more = page([item('3')]);
    more.meta.has_more = true;
    more.meta.next_cursor = 'opaque+/%';
    const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
      api: { get: async (resource, options) => {
        calls.push({ resource, params: options.params });
        if (delayed) return resource === 'executions' ? pendingList.promise : pendingSummary.promise;
        return resource === 'executions' ? more : summary();
      } } });
    t.after(() => view.dispose());
    await view.apply(defaultSelection(settings));
    dom.get('executions-next').dispatchEvent(new Event('click'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[2].params.cursor, 'opaque+/%');
    const button = dom.get(`executions-${control}`);
    button.focus();
    assert.equal(dom.document.activeElement, button);
    delayed = true;
    t.mock.timers.tick(30000);
    assert.equal(calls.length, 5);
    assert.equal(dom.document.activeElement, button);
    for (const key of ['previous', 'next', 'latest']) {
      const paging = dom.get(`executions-${key}`);
      assert.equal(paging.attributes.get('aria-disabled'), 'true');
      paging.dispatchEvent(new Event('click'));
    }
    assert.equal(calls.length, 5, 'Busy controls must not start or cancel a request');
    // Retention can remove the last row while the user is on a deeper page.
    pendingList.resolve(page([]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 6);
    assert.equal(dom.document.activeElement, button);
    assert.match(dom.body.textContent, /No executions remain/);
    dom.get('executions-latest').dispatchEvent(new Event('click'));
    assert.equal(calls.length, 6, 'Summary loading must also block paging');
    // Completion must not restore an old focus target after the user moves away.
    if (control === 'latest') dom.get('poll-toggle').focus();
    pendingSummary.resolve(summary());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.document.activeElement, control === 'latest' ? dom.get('poll-toggle') : button);
    assert.equal(dom.get('executions-next').attributes.get('aria-disabled'), 'true');
    assert.equal(dom.get('executions-previous').attributes.get('aria-disabled'), 'false');
    assert.equal(dom.get('executions-latest').attributes.get('aria-disabled'), 'false');
    dom.get('executions-next').dispatchEvent(new Event('click'));
    assert.equal(calls.length, 6, 'The terminal Next control must remain inactive');
    delayed = false;
    dom.get('executions-previous').dispatchEvent(new Event('click'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 8);
    assert.equal(dom.get('executions-previous').attributes.get('aria-disabled'), 'true');
    dom.get('executions-previous').dispatchEvent(new Event('click'));
    assert.equal(calls.length, 8, 'Previous on page one must remain inactive');
    await view.apply(null);
    for (const key of ['previous', 'next', 'latest']) assert.equal(dom.get(`executions-${key}`).disabled, true);
  });
}

test('keyed rendering reuses rows and links, patches values, removes/adds/reorders and restores current focus/scroll', async () => {
  const dom = overviewDOM(), pending = deferred();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    api: { get: async resource => resource === 'executions' ? ++lists === 1
      ? page([item('3'), item('2'), item('1')]) : pending.promise : summary() } });
  await view.apply(defaultSelection(settings));
  const oldRows = [...dom.body.children], link = oldRows[1].children[0].firstChild;
  assert.equal(link.href, '/dashboard/app/executions/2');
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
  assert.equal(dom.get('executions-status').textContent, 'Page 1 · 3 rows');
  assert.equal(dom.get('poll-status').textContent, 'Updated 17:00:00 · auto refresh on');
  assert.doesNotMatch(dom.get('executions-status').textContent, /Updated|Live results/);
  assert.equal(dom.get('overview-refresh').attributes.get('aria-disabled'), 'false');
  view.dispose();
});

test('removing a focused execution moves focus to the table region; unchanged rows stay intact', async () => {
  const dom = overviewDOM(), pending = deferred();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
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

test('transient refresh errors retain and label existing DOM; denial removes it and clears all counts', async t => {
  const dom = overviewDOM();
  let lists = 0;
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
    api: { get: async resource => {
      if (resource !== 'executions') return summary();
      if (++lists === 2) throw new ApiError('http', { status: 503 });
      if (lists === 3) throw new ApiError('http', { status: 403 });
      return page([item('3')]);
    } } });
  t.after(() => view.dispose());
  await view.apply(defaultSelection(settings));
  const row = dom.body.children[0];
  const refreshing = view.refresh();
  assert.match(dom.get('summary-status').textContent, /^Refreshing/);
  await refreshing;
  assert.equal(dom.body.children[0], row);
  assert.match(dom.get('executions-status').textContent, /Previous results shown/);
  assert.match(dom.get('summary-status').textContent, /Previous counts shown/);
  assert.ok(dom.get('executions-status').title.includes(wireTime));
  assert.ok(dom.get('summary-status').title.includes(wireTime));
  assert.doesNotMatch(dom.get('summary-status').textContent, /Refreshing/);
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
  const config = { metadata: settings, appBase: '/app/',
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

test('pause/resume controls, manual refresh and a paused return checkpoint preserve user intent', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = overviewDOM();
  let calls = 0;
  const config = { metadata: settings, appBase: '/app/', api: { get: async resource => {
    calls += 1;
    return resource === 'executions' ? page([item('3')]) : summary();
  } } };
  const view = mountOverview(dom.root, config);
  await view.apply(defaultSelection(settings));
  assert.equal(dom.get('poll-toggle').textContent, 'Pause auto refresh');
  dom.get('poll-toggle').dispatchEvent(new Event('click'));
  assert.equal(dom.get('poll-toggle').textContent, 'Resume auto refresh');
  dom.document.visibilityState = 'hidden';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  dom.document.visibilityState = 'visible';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  await view.refresh();
  assert.equal(calls, 4);
  assert.equal(dom.get('poll-status').textContent, 'Updated 17:00:00 · auto refresh paused');
  const saved = view.checkpoint();
  assert.equal(saved.view.autoPaused, true);
  view.dispose();
  const restored = mountOverview(dom.root, { ...config, retainedPaths: saved.paths, restoreView: saved.view });
  await restored.apply(defaultSelection(settings), { restore: true });
  t.mock.timers.tick(60000);
  assert.equal(calls, 6);
  assert.equal(dom.get('poll-toggle').textContent, 'Resume auto refresh');
  dom.get('poll-toggle').dispatchEvent(new Event('click'));
  t.mock.timers.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 8);
  restored.dispose();
});

test('visibility listener performs one return refresh and is removed with the overview', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = overviewDOM();
  let calls = 0;
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
    api: { get: async resource => { calls += 1; return resource === 'executions' ? page([item('3')]) : summary(); } } });
  await view.apply(defaultSelection(settings));
  dom.document.visibilityState = 'hidden';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  assert.match(dom.get('poll-status').textContent, /hidden/);
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  dom.document.visibilityState = 'visible';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  dom.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 4);
  view.dispose();
  dom.document.visibilityState = 'hidden';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  dom.document.visibilityState = 'visible';
  dom.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60000);
  assert.equal(calls, 4);
  assert.equal(dom.get('poll-toggle').disabled, true);
});

for (const appBase of ['/app/', '/ops/monitor/app/']) {
  test(`overview links open native detail and return the applied selection at page one under ${appBase}`, async t => {
    const settings = { ...metadata(), execution_statuses: [
      ...metadata().execution_statuses, { code: 4, name: 'failed' }, { code: 7, name: 'succeeded' }],
      execution_sorts: [...metadata().execution_sorts, 'package_name'] };
    const dom = overviewDOM(), calls = [], detailCalls = [];
    const selection = { ...defaultSelection(settings), folder: 'Folder + / 影狼\r\nline',
      project: 'Project %ZZ', status: [4, 7], from, to, sort: 'package_name', direction: 'asc', limit: 1 };
    const id = '9223372036854775807';
    const api = { async get(resource, { params }) {
      calls.push({ resource, params });
      if (resource === 'metrics/summary') return summary();
      assert.equal(resource, 'executions', 'Overview must not eagerly load detail resources');
      const response = page([item(id, { status: { code: 7, name: 'succeeded' } })]);
      Object.assign(response.meta, { upper_id: id, sort: params.sort, direction: params.direction, limit: params.limit,
        has_more: !params.cursor, next_cursor: params.cursor ? null : 'private-page-path' });
      return response;
    } };
    const view = mountOverview(dom.root, { metadata: settings, appBase, api });
    t.after(() => view.dispose());
    await view.apply(selection);
    dom.get('executions-next').dispatchEvent(new Event('click'));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(dom.get('executions-status').textContent, /^Page 2/);
    const link = new URL(dom.body.children[0].children[0].firstChild.href, dom.window.location.origin);
    assert.equal(link.pathname, `${appBase}executions/${id}`);
    assert.doesNotMatch(link.search, /cursor|private-page-path|package_name%253DProbe/);
    const detail = detailDOM();
    detail.window.location.search = link.search;
    const screen = mountDetail(detail.root, { metadata: settings, executionId: id, appBase,
      api: { async get(resource, options) { detailCalls.push({ resource, options });
        return resource.endsWith('/executables') ? executablePage([executable('1', { execution_id: id })]) : detailResponse(id); } } });
    t.after(() => screen.dispose());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(detailCalls.length, 2);
    assert.equal(detailCalls[0].resource, `executions/${id}`);
    assert.equal(detailCalls[0].options.params, undefined, 'Overview filters must not constrain the detail read');
    assert.equal(detail.get('overview-return-notice').hidden, true);
    assert.match(detail.get('overview-link').title, /page one/);
    const destination = new URL(detail.get('overview-link').href, dom.window.location.origin);
    assert.equal(destination.pathname, appBase);
    assert.deepEqual(parseSelection(destination.search, settings), selection);
    const returned = overviewDOM();
    const fresh = mountOverview(returned.root, { metadata: settings, appBase, api });
    t.after(() => fresh.dispose());
    await fresh.apply(parseSelection(destination.search, settings));
    assert.equal(calls.at(-2).params.cursor, undefined);
    assert.match(returned.get('executions-status').textContent, /^Page 1/);
    await view.apply({ ...selection, folder: 'Another folder', direction: 'desc' });
    const changed = new URL(dom.body.children[0].children[0].firstChild.href, dom.window.location.origin);
    const context = parseSelection(changed.searchParams.get('overview'), settings);
    assert.equal(context.folder, 'Another folder');
    assert.equal(context.direction, 'desc');
  });
}
