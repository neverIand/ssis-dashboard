import assert from 'node:assert/strict';
import test from 'node:test';
import { executionHref, readOverviewReturn } from '../src/detail-navigation.js';
import { createOverview } from '../src/overview.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection, parseSelection, selectionParams, selectionSearch } from '../src/selection.js';
import { calendarBound, createServerClock, nextDate, presetRange, projectTime, rangeLabel } from '../src/time-range.js';
import { deferred, envelope, wireTime } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';
import { overviewPage, timelineBucket, timelineMetadata, timelinePage, timelineSummary } from './timeline-fixture.js';

const metadata = timelineMetadata();
const selection = query => parseSelection(query, metadata);
const navigation = { appBase: '/ops/app/', origin: 'https://example.test', metadata };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('preset tokens are validated, shareable and retained by detail-return links without API tokens', () => {
  for (const token of ['24h', '7d', '30d', 'today']) {
    const value = selection(`?created=${token}&folder=Folder&limit=37`);
    assert.deepEqual(selection(selectionSearch(value, metadata)), value);
    assert.equal('created' in selectionParams(value), false);
    assert.match(rangeLabel(value, 'Europe/London'), /Last|Today/);
    const detail = new URL(executionHref('1', value, navigation), navigation.origin);
    const returned = readOverviewReturn(detail.search, navigation);
    assert.deepEqual(returned.selection, value);
    assert.deepEqual(selection(new URL(returned.href, navigation.origin).search), value);
  }
  for (const query of ['?created=all', '?created=24h&created=7d', '?created=',
    '?created=24h&from=2026-10-17T00:00:00Z', '?created=today&to=2026-10-17T00:00:00Z']) {
    assert.throws(() => selection(query), query);
  }
  const small = { ...metadata, limits: { ...metadata.limits, max_range_hours: 24 } };
  assert.throws(() => parseSelection('?created=7d', small));
  assert.equal(parseSelection('?created=today', small).created, 'today');
});

test('server clock advances precise server instants using elapsed monotonic time', t => {
  let elapsed = 0;
  const clock = createServerClock(wireTime, () => elapsed);
  t.mock.method(Date, 'now', () => Date.parse('2099-01-01T00:00:00Z'));
  assert.equal(clock.read(), wireTime);
  elapsed = 30000;
  assert.equal(clock.read(), '2026-10-17T16:00:30.1234567Z');
  clock.observe('1969-12-31T23:59:59.9999999Z');
  assert.equal(clock.read(), '1969-12-31T23:59:59.9999999Z');
  elapsed += 1000;
  assert.equal(clock.read(), '1970-01-01T00:00:00.9999999Z');
  assert.throws(() => createServerClock(null).read(), /Server time/);
});

function rolling(t, options = {}) {
  let elapsed = 0, state, asOf = wireTime;
  const calls = [];
  const serverNow = () => new Date(Date.parse(wireTime) + elapsed).toISOString().replace('.123Z', '.1234567Z');
  const owner = createOverview({ metadata, serverTime: wireTime, monotonicNow: () => elapsed,
    autoRefresh: false, ...options, publish: value => { state = value; }, api: {
      async get(resource, { params }) {
        calls.push({ resource, params });
        const bounds = { from: params.from, to: params.to, generated_at: serverNow() };
        if (resource === 'executions') {
          if (!params.cursor) asOf = serverNow();
          return overviewPage({ ...bounds, limit: params.limit,
            as_of: asOf, has_more: !params.cursor, next_cursor: params.cursor ? null : 'page-two' });
        }
        if (resource === 'metrics/summary') return timelineSummary(bounds);
        const buckets = [];
        let date = projectTime(params.from, metadata.display_timezone).date;
        while (calendarBound(date, '', metadata.display_timezone) < params.to) {
          const next = nextDate(date);
          buckets.push(timelineBucket(calendarBound(date, '', metadata.display_timezone), calendarBound(next, '', metadata.display_timezone)));
          date = next;
        }
        // The API uses canonical seven-digit UTC bounds for calendar buckets.
        for (const bucket of buckets) for (const key of ['start','end']) bucket[key] = bucket[key].replace('Z', '.0000000Z');
        return timelinePage(buckets, { ...bounds, selected_statuses: [] });
      },
    } });
  t.after(owner.dispose);
  return { owner, calls, advance(ms) { elapsed += ms; }, get state() { return state; } };
}

test('relative page one rolls on refresh, Previous and First page; deeper cursors replay exact bounds', async t => {
  const run = rolling(t), value = selection('?created=24h');
  await run.owner.apply(value);
  const first = run.state.page.meta;
  assert.equal(first.to, wireTime);
  assert.deepEqual(run.calls.map(call => call.resource), ['executions','metrics/summary']);
  run.advance(30000); await run.owner.refresh();
  assert.equal(run.state.page.meta.to, '2026-10-17T16:00:30.1234567Z');
  const refreshed = run.state.page.meta;
  await run.owner.next();
  assert.equal(run.state.pageNumber, 2);
  run.advance(30000); await run.owner.refresh();
  assert.equal(run.state.page.meta.to, refreshed.to);
  assert.equal(run.calls.at(-2).params.cursor, 'page-two');
  assert.equal(run.calls.at(-2).params.from, refreshed.from);
  await run.owner.previous();
  assert.equal(run.state.pageNumber, 1);
  assert.equal(run.state.page.meta.to, '2026-10-17T16:01:00.1234567Z');
  await run.owner.next(); run.advance(30000); await run.owner.latest();
  assert.equal(run.state.pageNumber, 1);
  assert.equal(run.calls.at(-2).params.cursor, undefined);
  assert.equal(run.state.page.meta.to, '2026-10-17T16:01:30.1234567Z');
  assert.equal(run.state.selection.created, '24h');
  assert.equal(run.calls.some(call => 'created' in call.params), false);
});

test('a restored deeper preset path uses its old window and a fresh detail-return resolves page one', async t => {
  const run = rolling(t), value = selection('?created=24h');
  await run.owner.apply(value); await run.owner.next();
  const paths = run.owner.checkpoint();
  const restored = rolling(t, { retainedPaths: paths });
  restored.advance(60000); await restored.owner.apply(value, { restore: true });
  assert.equal(restored.state.pageNumber, 2);
  assert.equal(restored.state.page.meta.to, wireTime);
  const fresh = rolling(t); fresh.advance(60000);
  const returned = readOverviewReturn(new URL(executionHref('1', value, navigation), navigation.origin).search, navigation);
  await fresh.owner.apply(returned.selection);
  assert.equal(fresh.state.pageNumber, 1);
  assert.equal(fresh.state.page.meta.to, '2026-10-17T16:01:00.1234567Z');
});

test('relative cycles retain the serialized list-summary-open-timeline sequence', async t => {
  const run = rolling(t);
  await run.owner.apply(selection('?created=24h'));
  await run.owner.toggleTimeline();
  assert.equal(run.state.timeline.error, null);
  run.calls.length = 0; run.advance(30000);
  await run.owner.refresh();
  assert.deepEqual(run.calls.map(call => call.resource), ['executions','metrics/summary','metrics/timeline']);
  assert.equal(run.state.timeline.error, null);
  assert.equal(run.calls[2].params.to, run.calls[0].params.to);
  run.calls.length = 0; await run.owner.toggleTimeline(); await run.owner.refresh();
  assert.deepEqual(run.calls.map(call => call.resource), ['executions','metrics/summary']);
});

test('scheduled preset refreshes advance page one without metadata requests or client wall time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout','Date'], now: Date.parse('2099-01-01T00:00:00Z') });
  const run = rolling(t, { autoRefresh: true });
  await run.owner.apply(selection('?created=24h'));
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    run.advance(30000); t.mock.timers.tick(30000); await flush();
    assert.equal(run.state.phase, 'ready');
    assert.equal(run.state.page.meta.to, `2026-10-17T16:0${cycle === 2 ? '1:00' : '0:30'}.1234567Z`);
    assert.equal(run.calls.length, 2 * (cycle + 1));
  }
  assert.equal(run.calls.some(call => call.resource === 'meta'), false);
});

test('absolute bookmarked bounds retain exact wire values across refreshes', async t => {
  const run = rolling(t);
  const bounds = presetRange('24h', wireTime, 'Europe/London');
  await run.owner.apply({ ...defaultSelection(metadata), ...bounds });
  run.advance(60000); await run.owner.refresh();
  assert.equal(run.calls.at(-2).params.from, bounds.from);
  assert.equal(run.calls.at(-2).params.to, bounds.to);
  assert.equal(run.state.selection.created, null);
});

test('summary cards include Other, apply exact statuses and clear with Total; row links retain selection', async t => {
  const dom = overviewDOM(), changes = [];
  const summary = timelineSummary(); summary.data.by_status[0].count = 2; summary.data.total += 2;
  const view = mountOverview(dom.root, { metadata, appBase: '/ops/app/', onSelect: value => changes.push(value),
    api: { get: async resource => resource === 'executions' ? overviewPage() : summary } });
  t.after(view.dispose);
  await view.apply(selection('?folder=Old&project=Old&status=2'));
  const card = key => dom.root.querySelector(`[data-status-card="${key}"]`);
  assert.equal(card('other').hidden, false);
  assert.equal(dom.root.querySelector('[data-count="other"]').textContent, '2');
  for (const [key, expected] of [['running',[2]],['succeeded',[7]],['failed',[4]],['other',[1]],['total',[]]]) {
    card(key).dispatchEvent(new Event('click', { cancelable: true }));
    assert.deepEqual(changes.at(-1), { status: expected });
    assert.deepEqual(selection(new URL(card(key).href, navigation.origin).search).status, expected);
  }
  const cells = dom.body.firstChild.children;
  assert.equal(cells[2].firstChild.href, cells[0].firstChild.href);
  const folder = cells[1].children[0], project = cells[1].children[1];
  folder.dispatchEvent(new Event('click', { cancelable: true }));
  assert.deepEqual(changes.at(-1), { folder: 'Folder', project: null });
  project.dispatchEvent(new Event('click', { cancelable: true }));
  assert.deepEqual(changes.at(-1), { folder: 'Folder', project: 'Project' });
  assert.equal(selection(new URL(folder.href, navigation.origin).search).project, null);
  assert.equal(selection(new URL(project.href, navigation.origin).search).project, 'Project');
  assert.deepEqual(selection(new URL(project.href, navigation.origin).search).status, [2]);
  const before = changes.length;
  const modified = new Event('click', { cancelable: true }); Object.defineProperty(modified, 'ctrlKey', { value: true });
  project.dispatchEvent(modified);
  assert.equal(changes.length, before); assert.equal(modified.defaultPrevented, false);
  summary.data.by_status[0].count = 0; summary.data.total -= 2;
  const packageLink = cells[2].firstChild; packageLink.focus(); await view.refresh();
  assert.equal(card('other').hidden, true);
  assert.equal(dom.body.firstChild.children[2].firstChild, packageLink);
  assert.equal(dom.document.activeElement, packageLink);
  summary.data.by_status.push({ code: 42, name: 'unknown', count: 3 }); summary.data.total += 3;
  await view.refresh();
  assert.equal(dom.root.querySelector('[data-count="other"]').textContent, '3');
  assert.equal(dom.get('summary-other-note').hidden, false);
  assert.match(dom.get('summary-other-note').textContent, /3 executions with unknown status codes/);
  await view.apply(null); assert.equal(card('failed').href, '');
  assert.equal(dom.get('summary-other-note').textContent, '');
});

test('keyboard summary activation keeps its link and focus through list and summary reloads', async t => {
  const dom = overviewDOM(), pending = [];
  let slow = false, applied = selection(''), applying;
  const summary = timelineSummary(); summary.data.by_status[0].count = 2; summary.data.total += 2;
  const page = () => ({ ...overviewPage(), data: [] });
  const card = key => dom.root.querySelector(`[data-status-card="${key}"]`);
  const view = mountOverview(dom.root, { metadata, appBase: '/ops/app/', onSelect(changes) {
    applied = { ...applied, ...changes }; applying = view.apply(applied);
  }, api: { get(resource) {
    if (!slow) return Promise.resolve(resource === 'executions' ? page() : summary);
    const wait = deferred(); pending.push(wait); return wait.promise;
  } } });
  t.after(view.dispose);
  await view.apply(applied); slow = true;
  for (const key of ['failed','total','other']) {
    const link = card(key); link.focus();
    // Enter activates a native link with a click (detail=0), not a keydown handler.
    const enter = new Event('click', { cancelable: true }); Object.defineProperty(enter, 'detail', { value: 0 });
    link.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    await flush();
    for (const stage of ['list','summary']) {
      assert.equal(dom.document.activeElement, link, stage);
      assert.equal(link.hidden, false, stage);
      assert.ok(link.href, stage);
      assert.equal(link.getAttribute('aria-disabled'), 'true');
      assert.deepEqual(selection(new URL(link.href, navigation.origin).search).status, applied.status);
      const duplicate = new Event('click', { cancelable: true }); link.dispatchEvent(duplicate);
      assert.equal(duplicate.defaultPrevented, true);
      assert.equal(pending.length, 1, 'Disabled activation must not start more work');
      pending.shift().resolve(stage === 'list' ? page() : summary);
      await flush();
    }
    await applying;
    assert.equal(dom.document.activeElement, link);
    assert.equal(link.getAttribute('aria-disabled'), 'false');
  }
  const refresh = view.refresh();
  pending.shift().resolve(page()); await flush();
  const zero = timelineSummary();
  pending.shift().resolve(zero); await refresh;
  assert.equal(card('other').hidden, true);
  assert.equal(dom.document.activeElement, card('total'), 'A withdrawn Other card has a visible focus fallback');
});
