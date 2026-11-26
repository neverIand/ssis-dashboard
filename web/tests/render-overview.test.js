import assert from 'node:assert/strict';
import test from 'node:test';
import { expectStyle, loadStylesheet } from './css-rules.js';
import { ApiError } from '../src/api.js';
import { mountOverview } from '../src/render-overview.js';
import { mountDetail } from '../src/render-detail.js';
import { defaultSelection, parseSelection, validateSelection } from '../src/selection.js';
import { deferred, envelope, metadata, requestId, wireTime } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { overviewDOM } from './overview-dom.js';
import { executable, executablePage } from './executable-fixture.js';
import { overviewPage, timelineFrom, timelineMetadata, timelinePage, timelineSummary } from './timeline-fixture.js';

const settings = metadata();
const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
const item = (id, changes = {}) => ({ execution_id: id, folder_name: '<b>影狼</b>', project_name: 'Project',
  package_name: 'Probe.dtsx', status: { code: 2, name: 'running' }, created_at: wireTime, started_at: wireTime,
  ended_at: null, duration_seconds: null, elapsed_seconds: 0, estimate: null, warning_count: 0, error_count: 0, ...changes });
const page = rows => ({ ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime,
  upper_id: '99', consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 50,
  has_more: false, next_cursor: null } });
const summary = () => ({ ...envelope({ total: 3, by_status: [{ code: 1, name: 'created', count: 0 },
  { code: 2, name: 'running', count: 3 }, { code: 4, name: 'failed', count: 0 }, { code: 7, name: 'succeeded', count: 0 }] }),
  meta: { ...envelope().meta, from, to, status_scope: 'all' } });

test('the cohort tip keeps the loaded window through refresh, updates it and clears it with the page', async t => {
  const dom = overviewDOM(), pending = deferred();
  let current = page([item('3')]), wait = false, denied = false;
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/', api: {
    async get(resource) {
      if (resource !== 'executions') return { ...summary(), meta: { ...summary().meta, from, to: current.meta.to } };
      if (denied) throw new ApiError('http', { status: 403 });
      return wait ? pending.promise : current;
    },
  } });
  t.after(view.dispose);
  const tip = dom.get('cohort-tip-window');
  assert.equal(dom.root.querySelector('[data-cohort-window]'), null);
  assert.equal(tip.textContent, '');
  await view.apply(defaultSelection(settings));
  assert.equal(tip.textContent, ' Window: 2026-10-17 01:00:00 → 2026-10-17 19:00:00 (end exclusive).');
  const loaded = tip.textContent;
  wait = true;
  const refreshing = view.refresh();
  assert.equal(tip.textContent, loaded, 'the retained page still owns its exact window');
  assert.equal(dom.get('poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00 · Previous counts shown.');
  current = { ...page([]), meta: { ...current.meta, to: '2026-10-18T18:00:00.7654321Z' } };
  pending.resolve(current); await refreshing;
  assert.equal(tip.textContent, ' Window: 2026-10-17 01:00:00 → 2026-10-18 19:00:00 (end exclusive).');
  denied = true; await view.refresh();
  assert.equal(tip.textContent, '', 'no window sentence remains without a loaded page');
});

test('Overview time hovers contain only the exact API timestamp on same-day and cross-day rows', async t => {
  const dom = overviewDOM(), tomorrow = '2026-10-18T16:00:00.9876543Z';
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/', api: {
    get: async resource => resource === 'executions' ? page([
      item('3'), item('2', { started_at: tomorrow }), item('1', { started_at: null, elapsed_seconds: null })]) : summary(),
  } });
  t.after(view.dispose);
  await view.apply(defaultSelection(settings));
  for (const [index, started] of [wireTime, tomorrow, null].entries()) {
    const cells = dom.body.children[index].children;
    assert.equal(cells[3].firstChild.title, wireTime);
    assert.equal(cells[3].firstChild.dateTime, wireTime);
    if (started === null) assert.equal(cells[4].textContent, '—');
    else {
      assert.equal(cells[4].firstChild.title, started);
      assert.equal(cells[4].firstChild.dateTime, started);
    }
  }
  assert.equal(dom.body.children[0].children[4].textContent, '17:00:00');
  assert.equal(dom.body.children[1].children[4].textContent, '2026-10-18 17:00:00');
});

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
  const cells = dom.body.children[0].children;
  assert.equal(cells[6].textContent, '9');
  assert.equal(cells[6].className, 'number-cell count-cell');
  assert.equal(cells[7].textContent, '0');
  assert.equal(cells[7].className, 'number-cell count-cell');
  assert.match(cells[5].textContent, /Elapsed:/);
  assert.equal(cells[8].firstChild.className, 'status-badge');
  assert.equal(cells[8].textContent, 'Running');
  assert.equal(oldRows[2].isConnected, false);
  assert.equal(dom.document.activeElement, link);
  assert.equal(dom.window.scrollX, 7);
  assert.equal(dom.window.scrollY, 250);
  assert.equal(dom.scroll.scrollLeft, 123);
  assert.equal(dom.scroll.scrollTop, 5);
  assert.equal(dom.get('executions-status').textContent, 'Page 1 · 3 rows');
  assert.equal(dom.get('poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
  assert.equal(dom.get('executions-status').title, 'Observed 2026-10-17 17:00:00');
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
      if (++lists === 2) throw new ApiError('http', { status: 503, requestId });
      if (lists === 3) throw new ApiError('http', { status: 403 });
      return page([item('3')]);
    } } });
  t.after(() => view.dispose());
  await view.apply(defaultSelection(settings));
  const row = dom.body.children[0];
  const refreshing = view.refresh();
  assert.equal(dom.get('summary-status').textContent, 'Updated 17:00:00');
  await refreshing;
  assert.equal(dom.body.children[0], row);
  assert.match(dom.get('executions-status').textContent, /Previous results shown/);
  assert.match(dom.get('summary-status').title, /Previous counts shown/);
  for (const key of ['executions-status', 'summary-status']) {
    assert.match(dom.get(key).title, /^Observed 2026-10-17 17:00:00 ·/);
    assert.ok(!dom.get(key).title.includes(wireTime));
  }
  assert.doesNotMatch(dom.get('summary-status').textContent, /Refreshing/);
  assert.equal(dom.get('poll-status').textContent, '⚠ Refresh failed · Updated 17:00:00 · retry scheduled');
  for (const status of ['poll-status', 'executions-status']) {
    assert.ok(dom.get(status).title.includes(requestId));
    assert.match(dom.get(status).title, /The service is unavailable/);
  }
  assert.equal(dom.get('app-status').textContent, '');
  await view.refresh();
  assert.equal(row.isConnected, false);
  assert.equal(dom.root.querySelector('[data-count="total"]').textContent, 'Not loaded');
  assert.equal(dom.root.querySelector('[data-count="total"]').getAttribute('data-empty'), 'true');
  assert.doesNotMatch(dom.get('executions-status').textContent, /Previous results shown/);
  assert.equal(dom.get('poll-status').textContent, '⚠ Executions unavailable · Auto refresh stopped');
  assert.equal(dom.get('overview-refresh').disabled, false);
  view.dispose();
  assert.equal(dom.get('overview-refresh').disabled, true);
});

for (const resource of ['executions', 'metrics/summary']) {
  test(`first ${resource} failure has a short header and full inline error`, async t => {
    const dom = overviewDOM(), calls = [];
    const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/', api: {
      async get(name) {
        calls.push(name);
        if (name === resource) throw new ApiError('network', { requestId });
        return page([item('3')]);
      },
    } });
    t.after(view.dispose);
    await view.apply(defaultSelection(settings));
    assert.equal(dom.get('poll-status').textContent, resource === 'executions'
      ? '⚠ Executions unavailable · Retry scheduled' : '⚠ Summary unavailable · Updated 17:00:00 · retry scheduled');
    for (const key of ['poll-status', 'executions-status']) {
      assert.ok(dom.get(key).title.includes(requestId));
      assert.match(dom.get(key).title, /Unable to connect\. Try again\./);
      assert.doesNotMatch(dom.get(key).title, /Previous (results|counts) shown/);
    }
    assert.match(dom.get('executions-status').textContent, /Unable to connect\. Try again\./);
    assert.deepEqual(calls, resource === 'executions' ? ['executions'] : ['executions', 'metrics/summary']);
  });
}

test('summary refresh failure uses the retained counts time and preserves full inline details', async t => {
  const dom = overviewDOM(), calls = [], counts = summary(); let fail = false;
  counts.meta.generated_at = '2026-10-17T15:00:00.0000000Z';
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/', api: {
    async get(resource) {
      calls.push(resource);
      if (resource === 'executions') return page([item('3')]);
      if (fail) throw new ApiError('http', { status: 503, requestId });
      return counts;
    },
  } });
  t.after(view.dispose);
  await view.apply(defaultSelection(settings));
  fail = true; await view.refresh();
  assert.equal(dom.get('poll-status').textContent, '⚠ Refresh failed · Updated 16:00:00 · retry scheduled');
  assert.match(dom.get('poll-status').title, /^Observed 2026-10-17 17:00:00 · Counts observed 2026-10-17 16:00:00 ·/);
  assert.equal(dom.get('poll-status').title.match(/Previous counts shown\./g).length, 1);
  for (const key of ['poll-status', 'executions-status']) {
    assert.ok(dom.get(key).title.includes(requestId));
    assert.match(dom.get(key).title, /The service is unavailable.*Previous counts shown/);
    assert.doesNotMatch(dom.get(key).title, /Page 1|Updated |T\d{2}:/);
  }
  assert.match(dom.get('executions-status').textContent, /Previous counts shown\. Page 1 · 1 rows/);
  assert.deepEqual(calls, ['executions', 'metrics/summary', 'executions', 'metrics/summary']);
  fail = false; dom.get('overview-refresh').dispatchEvent(new Event('click'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 5, 'Summary retry keeps its existing single-request owner');
  assert.equal(dom.get('poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
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
  assert.equal(dom.get('poll-toggle').getAttribute('aria-label'), 'Pause auto refresh');
  dom.get('poll-toggle').dispatchEvent(new Event('click'));
  assert.equal(dom.get('poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
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
  assert.equal(dom.get('poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
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

const failedSettings = metadata();
const failedItem = (id, code, packageName) => ({ execution_id: id, folder_name: 'Sales', project_name: 'Orders',
  package_name: packageName, status: { code, name: code === 4 ? 'failed' : 'succeeded' }, created_at: wireTime,
  started_at: wireTime, ended_at: wireTime, duration_seconds: 1, elapsed_seconds: null, estimate: null, warning_count: 0,
  error_count: code === 4 ? 2 : 0 });
const failedPage = rows => ({ ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime, upper_id: '9',
  consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 50, has_more: false, next_cursor: null } });
const failedSummary = () => ({ ...envelope({ total: 2, by_status: [{ code: 4, name: 'failed', count: 1 },
  { code: 7, name: 'succeeded', count: 1 }] }), meta: { ...envelope().meta, from, to, status_scope: 'all' } });

test('O2/O9: overview rows expose status for the failed-row marker and render breakable package names', async () => {
  const dom = overviewDOM();
  const view = mountOverview(dom.root, { metadata: failedSettings, appBase: '/app/',
    api: { get: async resource => resource === 'executions'
      ? failedPage([failedItem('2', 4, 'Load_Fact.dtsx'), failedItem('1', 7, 'Probe.dtsx')]) : failedSummary() } });
  await view.apply(defaultSelection(failedSettings));
  assert.deepEqual(dom.body.children.map(row => row.dataset.status), ['4', '7']);
  const packageLink = dom.body.children[0].children[2].firstChild;
  assert.equal(packageLink.textContent, 'Load_Fact.dtsx');
  assert.ok(packageLink.children.some(child => child.tag === 'wbr'));
  const created = dom.body.children[0].children[3].firstChild;
  assert.equal(created.tag, 'time');
  assert.deepEqual(created.children.map(child => child.tag), ['span', '#text', 'span'], 'date and time wrap as whole parts');
  assert.equal(created.textContent.split(' ').length, 2);
  view.dispose();
});

test('O1/O2/O8: count links inherit level colour; failed rows have a non-colour-only edge; mid widths keep right columns', async () => {
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, '.number-cell[data-level] a', 'color', 'inherit');
  for (const status of [4, 6]) {
    const edge = `[data-execution-table] tr[data-status="${status}"] > td:first-child`;
    await expectStyle(assert, sheet, edge, 'box-shadow', 'inset 3px 0 var(--sd-status-failed)');
    await expectStyle(assert, sheet, edge, 'border-left', '3px solid CanvasText', { media: '(forced-colors: active)' });
    // At phone and wide widths too, no shorthand or longhand removes the edge in forced colours.
    for (const width of [420, 1400]) {
      const options = { media: '(forced-colors: active)', width };
      await expectStyle(assert, sheet, edge, 'border-left-width', '3px', options);
      await expectStyle(assert, sheet, edge, 'border-left-style', 'solid', options);
    }
  }
  // Reduced motion: a changed row keeps a static highlight instead of the two-second flash, for both markers.
  for (const marker of ['0', '1']) {
    await expectStyle(assert, sheet, [`[data-execution-table] tr[data-changed="${marker}"]`, '[data-execution-table] tr[data-changed]'],
      'animation', 'none', { media: '(prefers-reduced-motion: reduce)' });
  }
  // Reduced motion: a running refresh dims the Refresh icon instead of turning it.
  await expectStyle(assert, sheet, '.icon-button[data-refreshing="true"] svg', 'animation', 'none',
    { media: '(prefers-reduced-motion: reduce)' });
  // Touch screens: picker inputs keep a 16 px font, so mobile browsers do not zoom into them.
  for (const control of ['.filter-popover input', '.filter-popover select']) {
    await expectStyle(assert, sheet, control, 'font-size', '16px', { media: '(pointer: coarse)', width: 420 });
  }
  // Between the narrow and wide layouts (900 px): dates wrap above times; above 1067 px they stay on one line.
  await expectStyle(assert, sheet, '[data-execution-table]', 'min-width', '44rem', { width: 900 });
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'min-width', '5.6rem', { width: 900 });
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'white-space', 'normal', { width: 900 });
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell span', 'white-space', 'nowrap', { width: 900 });
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'white-space', 'nowrap', { width: 1400 });
  await expectStyle(assert, sheet, '.summary-card', 'display', 'flex', { width: 1400 });
  await expectStyle(assert, sheet, '.summary-card', 'flex-wrap', 'wrap', { width: 1400 });
  await expectStyle(assert, sheet, '.summary-card', 'flex-direction', 'column', { width: 900 });
  await expectStyle(assert, sheet, '.summary-card', 'align-items', 'flex-start', { width: 900 });
});


const timelineSettings = timelineMetadata();
const selection = () => validateSelection(defaultSelection(timelineSettings), timelineSettings);
const row = (id, code) => ({ execution_id: id, folder_name: 'Folder', project_name: 'Project', package_name: 'Main.dtsx',
  status: { code, name: { 1: 'created', 2: 'running', 4: 'failed', 7: 'succeeded' }[code] }, created_at: timelineFrom,
  started_at: null, ended_at: null, duration_seconds: null, elapsed_seconds: null, estimate: null, warning_count: 0, error_count: 0 });
const listPage = rows => ({ ...overviewPage(), data: rows });
function screen(t, { list = () => overviewPage(), summary = () => timelineSummary(), timeline = () => timelinePage() } = {}) {
  const dom = overviewDOM(), selected = [], calls = [];
  const view = mountOverview(dom.root, { metadata: timelineSettings, appBase: '/ops/app/', onSelect: changes => selected.push(changes),
    api: { async get(resource, options) {
      calls.push(resource);
      return resource === 'executions' ? list(options) : resource === 'metrics/summary' ? summary(options) : timeline(options);
    } } });
  t.after(view.dispose);
  return { ...dom, view, selected, calls };
}

test('O10: a same-page refresh marks new and status-changed rows only; the first load marks none', async t => {
  let refreshed = false;
  const dom = screen(t, { list: () => listPage(refreshed ? [row('4', 2), row('3', 7), row('2', 2)] : [row('3', 2), row('2', 2)]) });
  await dom.view.apply(selection());
  assert.deepEqual(dom.body.children.map(node => node.dataset.changed), [undefined, undefined]);
  refreshed = true;
  await dom.view.refresh();
  const marks = Object.fromEntries(dom.body.children.map(node => [node.dataset.executionId, node.dataset.changed]));
  assert.ok(marks['4'] !== undefined, 'new row');
  assert.ok(marks['3'] !== undefined, 'running → succeeded');
  assert.equal(marks['2'], undefined, 'unchanged');
  await dom.view.refresh();
  assert.ok(dom.body.children.every(node => node.dataset.changed === undefined), 'marks clear when nothing changes');
});

test('O5/K2: the Other card names its parts; package links leave the Tab order to the equivalent ID link', async t => {
  const dom = screen(t, { summary: () => ({ ...timelineSummary(), data: { total: 13, by_status: [
    { code: 1, name: 'created', count: 2 }, { code: 2, name: 'running', count: 5 }, { code: 4, name: 'failed', count: 2 },
    { code: 7, name: 'succeeded', count: 4 }] } }) });
  await dom.view.apply(selection());
  const other = dom.root.querySelector('[data-status-card="other"]');
  assert.equal(other.getAttribute('aria-label'), '2 Other: Created 2');
  assert.match(other.title, /^Other: Created 2\. Filter selects Created/);
  const [id, , pkg] = [dom.body.children[0].children[0].firstChild, null, dom.body.children[0].children[2].firstChild];
  assert.equal(pkg.tabIndex, -1);
  assert.notEqual(id.tabIndex, -1);
  assert.equal(pkg.getAttribute('href'), id.getAttribute('href'));
});

test('R1-4: rows appearing on a refresh after an empty page are marked new', async t => {
  let refreshed = false;
  const dom = screen(t, { list: () => listPage(refreshed ? [row('9', 2)] : []) });
  await dom.view.apply(selection());
  refreshed = true;
  await dom.view.refresh();
  assert.notEqual(dom.body.children[0].dataset.changed, undefined);
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
  const [first, second] = dom.body.children.map(row => row.children[4].firstChild);
  assert.equal(first.textContent, '11:00:34');
  assert.equal(first.title, sameDay.started_at);
  assert.equal(second.title, nextDay.started_at);
  assert.equal(second.textContent, '2026-10-18 00:00:30', 'a run that starts after midnight keeps its date');
  assert.equal(dom.body.children[0].children[3].firstChild.textContent, '2026-10-17 11:00:00');
});

const estimateSettings = metadata();
// wireTime is 2026-10-17T16:00:00Z; a 25-minute typical run ends 16:25.
const estimate = (changes = {}) => ({ method: 'mean_last_5_successful', sample_count: 5, duration_seconds: 1500,
  ended_at: '2026-10-17T16:25:00.0000000Z', ...changes });
const estimateItem = (id, changes = {}) => ({ execution_id: id, folder_name: 'Folder', project_name: 'Project',
  package_name: 'Probe.dtsx', status: { code: 2, name: 'running' }, created_at: wireTime, started_at: wireTime,
  ended_at: null, duration_seconds: null, elapsed_seconds: 600, estimate: estimate(), warning_count: 0, error_count: 0,
  ...changes });
const estimateSummary = () => ({ ...envelope({ total: 3, by_status: [{ code: 2, name: 'running', count: 3 }] }),
  meta: { ...envelope().meta, from, to, status_scope: 'all' } });
const nb = text => text.split(' · ').map(part => part.replaceAll(' ', '\u00a0')).join(' · ');

test('C4: running rows compare elapsed with the typical duration, flag an overrun and never show a percentage', async t => {
  const dom = overviewDOM();
  let rows = [estimateItem('3'), estimateItem('2', { elapsed_seconds: 1800 }), estimateItem('1', { estimate: null })];
  const view = mountOverview(dom.root, { metadata: estimateSettings, appBase: '/app/',
    api: { get: async resource => resource === 'executions' ? page(rows) : estimateSummary() } });
  t.after(() => view.dispose());
  await view.apply(defaultSelection(estimateSettings));
  const detail = index => dom.body.children[index].children[5].children.at(-1);
  assert.equal(detail(0).textContent, nb('Elapsed: 10 min 00 s · typical 25 min 00 s'));
  assert.equal(detail(0).dataset.estimate, 'within');
  assert.equal(detail(0).title, 'Typical: mean of 5 earlier successful runs · expected end 2026-10-17 17:25:00');
  assert.equal(detail(1).dataset.estimate, 'over');
  assert.equal(detail(2).textContent, nb('Elapsed: 10 min 00 s'));
  assert.equal(detail(2).dataset.estimate, undefined);
  for (const index of [0, 1, 2]) assert.doesNotMatch(dom.body.children[index].children[5].textContent, /%/);
  // A refresh that changes only the estimate redraws the cell; an ended row shows its duration without a comparison.
  rows = [estimateItem('3', { estimate: estimate({ duration_seconds: 300 }) }), estimateItem('2', { status: { code: 7, name: 'succeeded' },
    ended_at: wireTime, duration_seconds: 1800, elapsed_seconds: 1800, estimate: null }), estimateItem('1', { estimate: null })];
  await view.apply(defaultSelection(estimateSettings), { restore: true });
  assert.equal(detail(0).textContent, nb('Elapsed: 10 min 00 s · typical 5 min 00 s'));
  assert.equal(detail(0).dataset.estimate, 'over');
  assert.equal(dom.body.children[1].children[5].textContent, '30 min 00 s');
});

const settle = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };
const click = node => { node.focus(); node.dispatchEvent(new Event('click')); };
// Deliberate geometry, not a browser/layout claim. A sticky toolbar's natural document top is 460 px.
function geometry(window, table, scroll, toolbar) {
  const header = { top: -150, bottom: -120 }, calls = [];
  window.scrollY = 700;
  window.scrollX = 13;
  scroll.clientWidth = 900;
  scroll.style.setProperty = (key, value) => { scroll.style[key] = value; };
  scroll.style.removeProperty = key => { delete scroll.style[key]; };
  toolbar.style.position = 'sticky';
  toolbar.getBoundingClientRect = () => {
    const natural = 460 - window.scrollY;
    const top = toolbar.style.position === 'static' ? natural : Math.max(0, natural);
    return { top, bottom: top + 40, height: 40, width: 800 };
  };
  table.querySelector('thead').getBoundingClientRect = () => ({ ...header, height: header.bottom - header.top });
  window.scrollTo = (x, y) => {
    const request = typeof x === 'object' ? x : { left: x, top: y };
    calls.push(request);
    window.scrollX = request.left;
    window.scrollY = request.top;
  };
  return { header, calls };
}
function overview(t, saved = null) {
  const dom = overviewDOM(), table = dom.root.querySelector('[data-execution-table]');
  const measured = geometry(dom.window, table, dom.scroll, dom.root.querySelector('.executions-toolbar'));
  let held = null;
  const reads = [];
  const view = mountOverview(dom.root, { metadata: timelineMetadata(), appBase: '/app/',
    retainedPaths: saved?.paths, restoreView: saved?.view,
    api: { async get(resource, { params }) {
      reads.push(resource);
      if (resource !== 'executions') return timelineSummary();
      const response = overviewPage({ limit: params.limit, sort: params.sort, direction: params.direction,
        has_more: true, next_cursor: 'page-two' });
      if (held) { const waiting = held; held = null; await waiting.promise; }
      return response;
    } } });
  t.after(view.dispose);
  return { ...dom, ...measured, view, reads, hold() { held = deferred(); return held; } };
}
const pagingSelection = changes => validateSelection({ ...defaultSelection(timelineMetadata()), ...changes }, timelineMetadata());

test('B3 Overview: Next/Previous/First/Rows wait for the new page; refresh, sort and filters leave the window alone', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = overview(t);
  await dom.view.apply(pagingSelection());
  assert.equal(dom.calls.length, 0);
  const wait = dom.hold(), next = dom.get('executions-next');
  click(next); await settle();
  assert.equal(dom.calls.length, 0);
  wait.resolve(); await settle();
  assert.deepEqual(dom.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
  assert.equal(dom.document.activeElement, next);

  Object.assign(dom.header, { top: 40, bottom: 70 });
  click(dom.get('executions-previous')); await settle();
  assert.equal(dom.calls.length, 1);
  Object.assign(dom.header, { top: -15, bottom: 15 });
  click(dom.get('executions-latest')); await settle();
  assert.equal(dom.calls.length, 2);
  await dom.view.apply(pagingSelection({ limit: 25 }));
  assert.equal(dom.calls.length, 3);
  await dom.view.refresh();
  click(dom.get('overview-refresh')); await settle();
  const beforePoll = dom.reads.filter(resource => resource === 'executions').length;
  t.mock.timers.tick(30000); await settle();
  assert.equal(dom.reads.filter(resource => resource === 'executions').length, beforePoll + 1);
  await dom.view.apply(pagingSelection({ limit: 25, sort: 'created_at' }));
  await dom.view.apply(pagingSelection({ limit: 25, folder: 'Another folder' }));
  assert.equal(dom.calls.length, 3, 'manual/automatic refresh, sort and same-size filters never reveal');
});

test('B3 Overview: retained-page restore keeps its saved window position', async t => {
  const first = overview(t);
  await first.view.apply(pagingSelection());
  click(first.get('executions-next')); await settle();
  first.window.scrollY = 310;
  const saved = first.view.checkpoint();
  first.view.dispose();
  const restored = overview(t, saved);
  await restored.view.apply(pagingSelection(), { restore: true });
  assert.deepEqual(restored.calls, [{ left: 13, top: 310 }]);
  assert.equal(restored.window.scrollY, 310);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const clickNode = node => node.dispatchEvent(new Event('click'));

test('a folder change clears the counts while a refresh spins the Refresh button without Refreshing… text', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata();
  let waiting = null;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource) {
    if (resource === 'executions') return waiting ? waiting.promise : overviewPage();
    return resource === 'metrics/summary' ? timelineSummary() : timelinePage();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata));
  const refresh = dom.get('overview-refresh'), total = dom.root.querySelector('[data-count="total"]');
  assert.equal(refresh.getAttribute('data-refreshing'), 'false');
  waiting = deferred(); const refreshing = view.refresh(); await flush();
  assert.equal(refresh.getAttribute('data-refreshing'), 'true');
  assert.doesNotMatch(dom.get('executions-status').textContent, /Refreshing/);
  assert.equal(total.textContent, '10');
  waiting.resolve(overviewPage()); waiting = null; await refreshing; await flush();
  assert.equal(refresh.getAttribute('data-refreshing'), 'false');
  // A selection change during a refresh ends the refresh cycle: the icon stops with it.
  waiting = deferred(); view.refresh(); await flush(); assert.equal(refresh.getAttribute('data-refreshing'), 'true');
  const replaced = waiting; waiting = deferred(); const changed = view.apply({ ...defaultSelection(metadata), status: [7] }); await flush();
  assert.equal(refresh.getAttribute('data-refreshing'), 'false');
  replaced.resolve(overviewPage()); waiting.resolve(overviewPage()); waiting = null; await changed; await flush();
  // A different folder is a different count scope: its counts are not carried.
  waiting = deferred(); const changing = view.apply({ ...defaultSelection(metadata), folder: 'Other' }); await flush();
  assert.equal(total.textContent, 'Not loaded'); assert.equal(total.getAttribute('data-empty'), 'true');
  assert.equal(refresh.getAttribute('data-refreshing'), 'false');
  waiting.resolve(overviewPage()); waiting = null; await changing; await flush();
});

test('carried counts are not actionable while loading and leave as soon as a page for a moved window arrives', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata(), selected = [];
  let list = null, summary = null, bounds = {};
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', onSelect: changes => selected.push(changes), api: { async get(resource) {
    if (resource === 'executions') return list ? list.promise : overviewPage(bounds);
    if (resource === 'metrics/summary') { if (summary) await summary.promise; return timelineSummary(bounds); }
    return timelinePage();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata));
  const total = dom.root.querySelector('[data-count="total"]'), failed = dom.root.querySelector('[data-status-card="failed"]');
  // A status change keeps the counts on view; activating a card meanwhile does nothing.
  list = deferred(); const changing = view.apply({ ...defaultSelection(metadata), status: [2] }); await flush();
  assert.equal(total.textContent, '10'); assert.equal(failed.getAttribute('aria-disabled'), 'true');
  const enter = new Event('click', { cancelable: true }); failed.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true); assert.deepEqual(selected, []);
  // The list comes back for a moved window: the old window's counts go before its own counts arrive.
  bounds = { from: '2026-10-17T00:00:30.0000000Z', to: '2026-10-17T18:00:30.0000000Z' }; summary = deferred();
  list.resolve(overviewPage(bounds)); list = null; await flush(); await flush();
  assert.equal(total.textContent, 'Not loaded'); assert.equal(total.getAttribute('data-empty'), 'true');
  summary.resolve(); summary = null; await changing; await flush();
  assert.equal(total.getAttribute('data-empty'), 'false');
});

test('overview keeps the open timeline, both reserved areas and the all-status counts through a delayed status change', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata(), calls = [], list = deferred(), timeline = deferred();
  let delay = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
    calls.push({ resource, ...options });
    if (resource === 'executions') return delay ? list.promise : overviewPage();
    if (resource === 'metrics/summary') return timelineSummary();
    return delay ? timeline.promise : timelinePage();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata)); clickNode(dom.get('timeline-toggle')); await flush();
  dom.scroll.layoutHeight = 821; dom.get('timeline-panel').layoutHeight = 671;
  dom.get('timeline-scroll').layoutHeight = 300;
  const status = dom.get('summary-status'), panelChildren = [...dom.get('timeline-panel').children];
  const row = dom.body.firstChild;
  delay = true;
  const applied = view.apply({ ...defaultSelection(metadata), status: [2] });
  assert.equal(dom.scroll.style.minHeight, '821px');
  assert.equal(dom.get('timeline-panel').style.minHeight, '671px');
  assert.equal(dom.get('timeline-scroll').style.minHeight, '300px');
  assert.equal(dom.get('timeline-panel').hidden, false);
  assert.deepEqual(dom.get('timeline-panel').children, panelChildren);
  assert.equal(dom.get('timeline-chart').children.length, 0);
  assert.equal(dom.get('timeline-selected').textContent, '');
  assert.equal(row.isConnected, false);
  // The counts cover every status of the same scope and window, so a status change keeps them on view, not actionable.
  assert.equal(dom.root.querySelector('[data-count="total"]').textContent, '10');
  assert.equal(dom.root.querySelector('[data-status-card="total"]').getAttribute('aria-disabled'), 'true');
  assert.equal(dom.get('cohort-tip-window').textContent, '');
  assert.equal(dom.get('summary-status'), status);
  list.resolve(overviewPage()); await flush();
  assert.equal(dom.get('timeline-panel').style.minHeight, '671px');
  timeline.resolve(timelinePage(undefined, { selected_statuses: [2] })); await applied;
  assert.equal(dom.scroll.style.minHeight, '');
  assert.equal(dom.get('timeline-panel').style.minHeight, '');
  assert.equal(dom.get('timeline-scroll').style.minHeight, '');
  assert.deepEqual(calls.map(call => call.resource), ['executions', 'metrics/summary', 'metrics/timeline',
    'executions', 'metrics/summary', 'metrics/timeline']);
});

test('overview refresh keeps keyed rows while announcing previous counts, then clears denied payloads and reservations', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata(), list = deferred();
  let delay = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource) {
    return resource === 'executions' ? delay ? list.promise : overviewPage() : timelineSummary();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata));
  const row = dom.body.firstChild, status = dom.get('summary-status');
  delay = true; const refresh = view.refresh();
  assert.equal(dom.body.firstChild, row);
  assert.equal(status.textContent, 'Updated 17:00:00');
  assert.match(status.title, /Previous counts shown/);
  assert.equal(dom.scroll.getAttribute('data-loading'), null);
  list.reject(new ApiError('forbidden', { status: 403 })); await refresh;
  assert.equal(row.isConnected, false);
  assert.equal(dom.scroll.style.minHeight ?? '', '');
  assert.equal(dom.get('cohort-tip-window').textContent, '');
});
