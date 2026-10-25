import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection } from '../src/selection.js';
import { deferred } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage } from './event-fixture.js';
import { parameterPage } from './parameter-fixture.js';
import { overridePage } from './override-fixture.js';
import { historyMetadata, historyPage } from './history-fixture.js';
import { overviewDOM } from './overview-dom.js';
import { overviewPage, timelineBucket, timelineMetadata, timelinePage, timelineSummary } from './timeline-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const click = node => node.dispatchEvent(new Event('click'));
const bodyKeys = { executables: 'body', children: 'childBody', events: 'eventBody',
  parameters: 'parameterBody', overrides: 'overrideBody', history: 'historyBody' };
function settings() {
  const value = eventMetadata();
  value.execution_statuses = historyMetadata().execution_statuses;
  value.capabilities.values = value.capabilities.override_values = true;
  return value;
}
function reply(resource, { params }) {
  if (resource.endsWith('/executables')) return executablePage(undefined, params);
  if (resource.endsWith('/children')) return childPage(undefined, params);
  if (resource.endsWith('/events')) return eventPage(undefined, params);
  if (params?.section === 'parameters') return parameterPage(undefined, params);
  if (params?.section === 'overrides') return overridePage(undefined, params);
  if (resource === 'history') return historyPage(undefined, params);
  return detailResponse('17');
}

for (const section of Object.keys(bodyKeys)) {
  test(`${section}: a delayed scope reload reserves the former area, removes old payloads and retains controls`, async t => {
    const dom = detailDOM(), calls = [], pending = deferred();
    let delay = false;
    dom.window.location.hash = `#${section}`;
    const view = mountDetail(dom.root, { metadata: settings(), executionId: '17', appBase: '/app/',
      api: { async get(resource, options) {
        calls.push({ resource, ...options });
        return delay ? pending.promise : reply(resource, options);
      } } });
    t.after(view.dispose);
    await flush();
    const body = dom[bodyKeys[section]], region = dom.get(`${section}-scroll`), oldRow = body.firstChild;
    const status = dom.get(`${section}-status`), notice = dom.get(`${section}-notice`);
    const children = [...dom.get(`${section}-panel`).children];
    const limit = dom.get(`${section}-limit`);
    region.layoutHeight = 763.2; // Injected geometry tests the reservation, not browser layout.
    if (section === 'history') {
      click(dom.get('history-chart-toggle'));
      dom.get('history-chart-panel').layoutHeight = 511;
    }
    limit.focus(); limit.value = '25'; delay = true;
    const before = calls.length;
    limit.dispatchEvent(new Event('change'));
    assert.equal(calls.length, before + 1);
    assert.equal(region.style.minHeight, '764px');
    assert.equal(region.getAttribute('data-loading'), '');
    assert.equal(oldRow.isConnected, false, 'An old-selection row cannot look current or remain as hidden payload');
    assert.match(body.textContent, /Loading/);
    assert.equal(dom.document.activeElement, limit);
    assert.equal(dom.get(`${section}-status`), status);
    assert.equal(dom.get(`${section}-notice`), notice);
    assert.deepEqual(dom.get(`${section}-panel`).children, children);
    if (section === 'history') {
      assert.equal(dom.get('history-chart-panel').hidden, false);
      assert.equal(dom.get('history-chart-panel').style.minHeight, '511px');
      assert.equal(dom.get('history-chart-plot').children.length, 0);
      assert.equal(dom.get('history-chart-selected').textContent, '');
      assert.match(dom.get('history-chart-scope').textContent, /Loading/);
    }
    const request = calls.at(-1);
    pending.resolve(reply(request.resource, request)); await flush();
    assert.equal(region.style.minHeight, '');
    assert.equal(region.getAttribute('data-loading'), null);
    assert.equal(dom.document.activeElement, limit);
    assert.equal(calls.length, before + 1);
    assert.doesNotMatch(status.textContent, /Previous/);
    if (section === 'history') assert.equal(dom.get('history-chart-panel').style.minHeight, '');
    view.dispose();
    assert.equal(region.style.minHeight, '');
  });
}

test('overview keeps the open timeline and both reserved areas through a delayed selection change without old counts', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata(), calls = [], list = deferred(), timeline = deferred();
  let delay = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
    calls.push({ resource, ...options });
    if (resource === 'executions') return delay ? list.promise : overviewPage();
    if (resource === 'metrics/summary') return timelineSummary();
    return delay ? timeline.promise : timelinePage();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata)); click(dom.get('timeline-toggle')); await flush();
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
  assert.equal(dom.root.querySelector('[data-count="total"]').textContent, '—');
  assert.equal(dom.get('cohort-window').hidden, false);
  assert.equal(dom.get('cohort-window').textContent, '');
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
  assert.match(status.textContent, /Previous counts shown/);
  assert.equal(dom.scroll.getAttribute('data-loading'), null);
  list.reject(new ApiError('forbidden', { status: 403 })); await refresh;
  assert.equal(row.isConnected, false);
  assert.equal(dom.scroll.style.minHeight ?? '', '');
  assert.equal(dom.get('cohort-window').hidden, false);
  assert.equal(dom.get('cohort-window').textContent, '');
});

for (const scenario of ['empty retained start', 'non-empty retained start', 'all zero']) {
  test(`timeline grain change: ${scenario} uses the correct fallback with one owned read`, async t => {
    const dom = overviewDOM(), metadata = timelineMetadata(), calls = [];
    const hour = index => new Date(Date.UTC(2026, 9, 17, index)).toISOString().replace('.000Z', '.0000000Z');
    const bounds = { from: hour(0), to: hour(24) };
    const rows = Array.from({ length: 24 }, (_, index) => timelineBucket(hour(index), hour(index + 1), {
      created_count: scenario === 'all zero' ? 0 : index === (scenario === 'non-empty retained start' ? 0 : 17) ? 5 : 0,
      started_count: 0, succeeded_count: 0, failed_count: 0,
    }));
    const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
      calls.push({ resource, ...options });
      return resource === 'executions' ? overviewPage(bounds) : resource === 'metrics/summary' ? timelineSummary(bounds)
        : timelinePage(options.params.bucket === 'day' ? [timelineBucket(hour(0), hour(24))] : rows,
          { ...bounds, bucket: options.params.bucket });
    } } });
    t.after(view.dispose);
    await view.apply(defaultSelection(metadata)); click(dom.get('timeline-toggle')); await flush();
    assert.equal(dom.get('timeline-choice').value, hour(0));
    const before = calls.length;
    dom.get('timeline-bucket').value = 'hour'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).params.bucket, 'hour');
    assert.equal(dom.get('timeline-choice').value, hour(scenario === 'all zero' ? 23 : scenario === 'empty retained start' ? 17 : 0));
    dom.get('timeline-choice').value = hour(0); dom.get('timeline-choice').dispatchEvent(new Event('change'));
    await view.refresh();
    assert.equal(dom.get('timeline-choice').value, hour(0), 'Same-grain refresh retains an intentionally selected empty bucket');
    assert.equal(calls.length, before + 4);
  });
}

test('timeline grain fallback survives a failed intermediate grain without claiming a hidden panel is expanded', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata();
  const day = index => `2026-10-${17 + index}T00:00:00.0000000Z`;
  const bounds = { from: day(0), to: day(2) };
  let changed = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
    if (resource === 'executions') return overviewPage(bounds);
    if (resource === 'metrics/summary') return timelineSummary(bounds);
    if (options.params.bucket === 'hour') throw new ApiError('invalid_request', { status: 400 });
    return timelinePage([0, 1].map(index => timelineBucket(day(index), day(index + 1), {
      created_count: index === (changed ? 1 : 0) ? 5 : 0, started_count: 0, succeeded_count: 0, failed_count: 0,
    })), bounds);
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata)); click(dom.get('timeline-toggle')); await flush();
  assert.equal(dom.get('timeline-choice').value, day(0));
  dom.get('timeline-bucket').value = 'hour'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
  assert.equal(dom.get('timeline-chart').children.length, 0);
  changed = true;
  dom.get('timeline-bucket').value = 'day'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
  assert.equal(dom.get('timeline-choice').value, day(1));
  click(dom.get('timeline-toggle'));
  assert.equal(dom.get('timeline-panel').hidden, true);
  assert.equal(dom.get('timeline-toggle').getAttribute('aria-expanded'), 'false');
});

test('native templates reserve feedback before content, consolidate Events metadata and retain live announcements', () => {
  const template = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const detail = template('execution'), overview = template('index');
  assert.match(detail, /detail-state resource-feedback[^>]*>[\s\S]*?data-detail-status role="status"/);
  for (const resource of Object.keys(bodyKeys)) {
    assert.match(detail, new RegExp(`class="resource-feedback"[^>]*>\\s*<p[^>]*data-${resource}-notice role="status"></p>\\s*<p[^>]*data-${resource}-status role="status"></p>`));
  }
  assert.match(detail, /class="events-meta">\s*<p[^>]*><span data-events-scope><\/span><span data-events-order-label><\/span><\/p>/);
  assert.match(detail, /class="visually-hidden" id="event-search-hint"/);
  assert.doesNotMatch(detail, /<caption>Recorded events<\/caption>/);
  assert.match(overview, /class="cohort-window status-slot" data-cohort-window(?! hidden)/);
  assert.match(overview, /data-execution-scroll data-loading/);
  assert.match(overview, /data-summary-status role="status"/);
});
