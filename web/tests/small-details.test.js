import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { childPage } from './child-fixture.js';
import { executablePage } from './executable-fixture.js';
import { metadata } from './fixtures.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const click = node => node.dispatchEvent(new Event('click'));
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function mount(dom, settings, get) {
  return mountDetail(dom.root, { metadata: settings, executionId: '17', appBase: '/app/', api: { get } });
}
const reply = resource => resource.endsWith('/executables') ? executablePage()
  : resource.endsWith('/children') ? childPage() : detailResponse('17');

test('H-01: remounting on the same DOM keeps one Events category option per kind', async () => {
  const dom = detailDOM(), settings = metadata();
  settings.capabilities.events = true; settings.event_kinds = ['all', 'errors', 'warnings'];
  for (let mounts = 0; mounts < 2; mounts++) { mount(dom, settings, async resource => reply(resource)).dispose(); }
  assert.deepEqual(dom.get('events-kind').children.map(option => option.value), ['all', 'errors', 'warnings']);
});

test('H-02: after a failed base refresh a newly opened section offers Retry, which reloads the base first', async t => {
  const dom = detailDOM(), calls = []; let fail = false;
  dom.window.location.hash = '#executables';
  const view = mount(dom, metadata(), async resource => {
    calls.push(resource);
    if (fail) throw new ApiError('network');
    return reply(resource);
  });
  t.after(view.dispose); await flush();
  fail = true; click(dom.get('detail-refresh')); await flush();
  click(dom.get('children-toggle')); await flush();
  assert.match(dom.get('children-status').textContent, /Unable to connect/);
  assert.equal(dom.get('children-retry').hidden, false);
  fail = false; calls.length = 0;
  click(dom.get('children-retry')); await flush();
  assert.deepEqual(calls, ['executions/17', 'executions/17/children']);
  assert.equal(dom.get('children-retry').hidden, true);
  assert.equal(dom.childBody.children.length, 1);
});

test('H-05: one visible line names disabled sections; enabled capabilities show none', async t => {
  const off = detailDOM(), view = mount(off, metadata(), async resource => reply(resource));
  t.after(view.dispose); await flush();
  assert.equal(off.get('tab-notes').hidden, false);
  assert.equal(off.get('tab-notes').textContent, 'Disabled for this application: Events, Parameters, Overrides');
  const on = detailDOM(), settings = metadata();
  Object.assign(settings.capabilities, { events: true, values: true, override_values: true });
  const enabled = mount(on, settings, async resource => reply(resource));
  t.after(enabled.dispose); await flush();
  assert.equal(on.get('tab-notes').hidden, true);
  assert.equal(on.get('tab-notes').textContent, '');
});

test('H-06: selecting a tab outside a narrow strip scrolls only the strip', async t => {
  const dom = detailDOM(), list = dom.get('history-toggle').parentElement;
  list.getBoundingClientRect = () => ({ left: 0, right: 345 });
  dom.get('history-toggle').getBoundingClientRect = () => ({ left: 500, right: 580 });
  dom.window.location.hash = '#history';
  const view = mount(dom, metadata(), async resource => resource === 'history'
    ? { data: [], meta: { generated_at: detailResponse().meta.generated_at, has_next: false, next_cursor: null, limit: 50 } }
    : reply(resource));
  t.after(view.dispose); await flush();
  assert.equal(dom.get('history-toggle').getAttribute('aria-selected'), 'true');
  assert.equal(list.scrollLeft, 235);
  assert.equal(dom.window.scrollY, 0);
});

test('H-12: a first page without observations has a compact message without "on this page"', async t => {
  const dom = detailDOM(), view = mount(dom, metadata(), async resource =>
    resource.endsWith('/executables') ? executablePage([], { availability: 'available' }) : reply(resource));
  t.after(view.dispose); await flush();
  assert.equal(dom.body.textContent, 'No executable observations.');
});

test('H-07: the timeline opens between the Executions toolbar and its table', () => {
  const html = source('../../dashboard/templates/app/index.html');
  const section = html.indexOf('<section class="executions panel"'), toggle = html.indexOf('data-timeline-toggle');
  const panel = html.indexOf('data-timeline-panel'), table = html.indexOf('data-execution-scroll');
  assert.ok(section < toggle && toggle < panel && panel < table);
  assert.doesNotMatch(html, /class="panel timeline-panel"/);
});

test('H-03, H-09–H-11, H-14: compact toolbar controls, inline Retry, aligned titles and grouped pagers', () => {
  const css = source('../src/styles.css');
  assert.match(css, /\.toolbar-meta > \.inline-status \{ flex: 0 1 auto;/);
  assert.match(css, /\.table-toolbar > button, \.toolbar-filters button:not\(\.info-trigger\), \.table-toolbar select, \.table-toolbar input \{\s*height: 2\.2rem; min-height: 2\.2rem;/);
  assert.match(css, /\.detail-title \{ display: flex; align-items: baseline;/);
  assert.match(css, /\.detail-table th button \{ min-height: 0;/);
  assert.match(css, /\.table-paging \{ display: flex;[^}]*margin-left: auto; \}/);
  const controls = source('../../dashboard/templates/app/controls.html');
  assert.match(controls, /<div class="table-paging">\s*<label class="page-size">/);
});

test('H-04 (R1-F001): observation Started/Ended cells never wrap and get room for a full cross-day timestamp', () => {
  const css = source('../src/styles.css');
  assert.match(css, /\[data-executables-table\] \.time-cell, \[data-children-table\] \.time-cell \{ white-space: nowrap; \}/);
  assert.match(css, /\[data-executables-table\] col:nth-child\(3\), \[data-executables-table\] col:nth-child\(4\),\s*\[data-children-table\] col:nth-child\(2\), \[data-children-table\] col:nth-child\(3\) \{ width: 12\.5rem; \}/);
  for (const [table, width] of [['executables', '58rem'], ['children', '56rem']]) {
    assert.ok(css.includes(`[data-${table}-table] { min-width: ${width}; }`), table);
  }
});
