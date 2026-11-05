import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountFilters } from '../src/filters.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { envelope, metadata as baseMetadata, wireTime } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';
import { overviewDOM } from './overview-dom.js';
import { overviewPage, timelineBucket, timelineFrom, timelineMetadata, timelinePage, timelineSummary, timelineTo }
  from './timeline-fixture.js';

// UX review 2026-11-05, batch B3: overview behaviour. No new request kinds; drill-down uses the normal selection path.
const flush = () => new Promise(resolve => setImmediate(resolve));
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const metadata = timelineMetadata();
const selection = () => validateSelection(defaultSelection(metadata), metadata);
const row = (id, code) => ({ execution_id: id, folder_name: 'Folder', project_name: 'Project', package_name: 'Main.dtsx',
  status: { code, name: { 1: 'created', 2: 'running', 4: 'failed', 7: 'succeeded' }[code] }, created_at: timelineFrom,
  started_at: null, ended_at: null, duration_seconds: null, elapsed_seconds: null, warning_count: 0, error_count: 0 });
const listPage = rows => ({ ...overviewPage(), data: rows });
function screen(t, { list = () => overviewPage(), summary = () => timelineSummary(), timeline = () => timelinePage() } = {}) {
  const dom = overviewDOM(), selected = [], calls = [];
  const view = mountOverview(dom.root, { metadata, appBase: '/ops/app/', onSelect: changes => selected.push(changes),
    api: { async get(resource, options) {
      calls.push(resource);
      return resource === 'executions' ? list(options) : resource === 'metrics/summary' ? summary(options) : timeline(options);
    } } });
  t.after(view.dispose);
  return { ...dom, view, selected, calls };
}
const fire = (svg, type, target, key) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  if (key) Object.defineProperty(event, 'key', { value: key });
  svg.dispatchEvent(event);
};

test('O6: Enter, double click or the button filter the list to a bucket, clamped to the applied window', async t => {
  // The day bucket starts before and ends after the applied window, so both edges must be clamped.
  const dom = screen(t, { timeline: () => timelinePage([timelineBucket('2026-10-16T23:00:00.0000000Z', '2026-10-17T23:00:00.0000000Z')]) });
  await dom.view.apply(selection());
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart'), bar = svg.children[0];
  assert.equal(dom.get('timeline-drill').hidden, false);
  const reads = dom.calls.length;
  fire(svg, 'keydown', bar, 'ArrowRight');
  assert.equal(dom.selected.length, 0, 'arrows only select');
  fire(svg, 'keydown', bar, 'Enter');
  fire(svg, 'dblclick', bar);
  dom.get('timeline-drill').dispatchEvent(new Event('click'));
  const expected = { created: null, from: timelineFrom, to: timelineTo };
  assert.deepEqual(dom.selected, [expected, expected, expected]);
  assert.equal(dom.calls.length, reads, 'the drill itself reads nothing; the selection change does');
});

test('O6: an inner bucket keeps its own server bounds', async t => {
  const from = '2026-10-15T23:00:00.0000000Z', to = '2026-10-18T23:00:00.0000000Z';
  const day = (start, end) => timelineBucket(start, end, { created_count: 1, started_count: 1, succeeded_count: 1, failed_count: 0 });
  const buckets = [day(from, '2026-10-16T23:00:00.0000000Z'), day('2026-10-16T23:00:00.0000000Z', '2026-10-17T23:00:00.0000000Z'),
    day('2026-10-17T23:00:00.0000000Z', to)];
  const dom = screen(t, { list: () => overviewPage({ from, to }), summary: () => timelineSummary({ from, to }),
    timeline: () => timelinePage(buckets, { from, to }) });
  await dom.view.apply(validateSelection({ ...defaultSelection(metadata), from, to }, metadata));
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart');
  assert.equal(svg.children.length, 3);
  fire(svg, 'keydown', svg.children[1], 'Enter');
  assert.deepEqual(dom.selected.at(-1), { created: null, from: buckets[1].start, to: buckets[1].end });
});

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

test('O7: the default preset reads in days and exact timestamps sit under a closed Advanced disclosure', () => {
  const settings = baseMetadata();
  settings.limits = { ...settings.limits, default_range_hours: 360 };
  const dom = filtersDOM(settings);
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/app/', effectiveWindow: () => null,
    onApplied: () => {}, api: { get: async () => envelope([]) } });
  assert.equal(dom.get('[data-created-preset="default"]').textContent, 'Default window (15 days)');
  filters.dispose?.();
  const html = source('../../dashboard/templates/app/index.html');
  assert.match(html, /<details class="exact-times"><summary>Advanced: exact timestamps<\/summary>/);
  assert.doesNotMatch(html, /<details class="exact-times" open/);
});

test('K1: chart roots are not Tab stops; their selected point is', () => {
  for (const [file, attribute] of [['index', 'data-timeline-chart'], ['history-panel', 'data-history-chart-plot']]) {
    assert.match(source(`../../dashboard/templates/app/${file}.html`), new RegExp(`<svg [^>]*${attribute}[^>]* tabindex="-1"`), file);
  }
});

// Codex review round 1 (2026-11-05) regressions.
test('R1-3/5: Enter drill moves keyboard focus to the list; a cleared chart hides Show this bucket', async t => {
  let broken = false;
  const dom = screen(t, { timeline: () => { if (broken) throw new ApiError('http', { status: 400 }); return timelinePage(); } });
  await dom.view.apply(selection());
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart'), bar = svg.children[0];
  bar.focus();
  fire(svg, 'keydown', bar, 'Enter');
  assert.equal(dom.document.activeElement, dom.scroll, 'focus follows the filtered list');
  dom.get('timeline-drill').focus();
  broken = true;
  await dom.view.refresh(); await flush();
  assert.equal(dom.get('timeline-drill').hidden, true);
  assert.notEqual(dom.document.activeElement, dom.get('timeline-drill'));
});

test('R1-4: rows appearing on a refresh after an empty page are marked new', async t => {
  let refreshed = false;
  const dom = screen(t, { list: () => listPage(refreshed ? [row('9', 2)] : []) });
  await dom.view.apply(selection());
  refreshed = true;
  await dom.view.refresh();
  assert.notEqual(dom.body.children[0].dataset.changed, undefined);
});

test('R1-2: header stickiness and clipping depend on a measured fit, never on width alone', async t => {
  const dom = screen(t);
  dom.scroll.clientWidth = 900;
  await dom.view.apply(selection());
  assert.equal(dom.scroll.dataset.fits, '', 'an 800 px table fits a 900 px region');
  dom.scroll.clientWidth = 700;
  await dom.view.refresh();
  assert.equal(dom.scroll.dataset.fits, undefined, 'a wider table keeps its horizontal scroll');
  assert.match(source('../src/styles.css'), /\[data-execution-scroll\]\[data-fits\] \{ overflow-x: clip; \}/);
  assert.doesNotMatch(source('../src/styles.css'), /^\s*\[data-execution-scroll\] \{ overflow-x: clip; \}/m, 'no width-only clip');
});
