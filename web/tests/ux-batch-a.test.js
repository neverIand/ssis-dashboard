import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection } from '../src/selection.js';
import { breakableText } from '../src/ui.js';
import { envelope, metadata, wireTime } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';

// UX review 2026-11-05, batch A: styling and copy only, no new requests or API fields.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = metadata();
const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
const item = (id, code, packageName) => ({ execution_id: id, folder_name: 'Sales', project_name: 'Orders',
  package_name: packageName, status: { code, name: code === 4 ? 'failed' : 'succeeded' }, created_at: wireTime,
  started_at: wireTime, ended_at: wireTime, duration_seconds: 1, elapsed_seconds: null, warning_count: 0,
  error_count: code === 4 ? 2 : 0 });
const page = rows => ({ ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime, upper_id: '9',
  consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 50, has_more: false, next_cursor: null } });
const summary = () => ({ ...envelope({ total: 2, by_status: [{ code: 4, name: 'failed', count: 1 },
  { code: 7, name: 'succeeded', count: 1 }] }), meta: { ...envelope().meta, from, to, status_scope: 'all' } });

test('O9: names get break opportunities after separators while their text stays identical', () => {
  const dom = overviewDOM(), node = dom.document.createElement('a');
  breakableText(node, 'Load_Fact_Sales.dtsx');
  assert.equal(node.textContent, 'Load_Fact_Sales.dtsx');
  assert.deepEqual(node.children.map(child => child.tag), ['#text', 'wbr', '#text', 'wbr', '#text', 'wbr', '#text']);
  const before = [...node.children];
  breakableText(node, 'Load_Fact_Sales.dtsx');
  assert.deepEqual(node.children, before, 'unchanged names keep their nodes');
  breakableText(node, 'Probe');
  assert.equal(node.textContent, 'Probe');
  assert.equal(node.children.length, 1);
});

test('O2/O9: overview rows expose status for the failed-row marker and render breakable package names', async () => {
  const dom = overviewDOM();
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
    api: { get: async resource => resource === 'executions'
      ? page([item('2', 4, 'Load_Fact.dtsx'), item('1', 7, 'Probe.dtsx')]) : summary() } });
  await view.apply(defaultSelection(settings));
  assert.deepEqual(dom.body.children.map(row => row.dataset.status), ['4', '7']);
  const packageLink = dom.body.children[0].children[2].firstChild;
  assert.equal(packageLink.textContent, 'Load_Fact.dtsx');
  assert.ok(packageLink.children.some(child => child.tag === 'wbr'));
  const created = dom.body.children[0].children[4].firstChild;
  assert.equal(created.tag, 'time');
  assert.deepEqual(created.children.map(child => child.tag), ['span', '#text', 'span'], 'date and time wrap as whole parts');
  assert.equal(created.textContent.split(' ').length, 2);
  view.dispose();
});

test('O1/O2/O8: count links inherit level colour; failed rows have a non-colour-only edge; mid widths keep right columns', () => {
  const css = source('../src/styles.css');
  assert.ok(css.includes('.number-cell[data-level] a { color: inherit; }'));
  assert.ok(css.includes('[data-execution-table] tr:is([data-status="4"], [data-status="6"]) > td:first-child'));
  assert.match(css, /td:first-child \{ box-shadow: inset 3px 0 var\(--sd-status-failed\); \}/);
  assert.match(css, /@media \(forced-colors: active\) \{[^}]*border-left: 3px solid CanvasText;/);
  assert.match(css, /@media \(max-width: 66\.6667rem\) \{\s*\/\*[^*]*\*\/\s*\[data-execution-table\] \{ min-width: 44rem; \}\s*\[data-execution-table\] \.time-cell \{ min-width: 5\.6rem; white-space: normal; \}\s*\[data-execution-table\] \.time-cell span \{ white-space: nowrap; \}/);
  assert.match(css, /\.summary-card \{\s*display: flex;\s*flex-wrap: wrap;/);
  assert.match(css, /\.summary-card \{ flex-direction: column; align-items: flex-start;/);
});

test('D6/G5/G6: summary fields follow the run timeline; header groups connection context and ends with Theme', () => {
  const detail = source('../../dashboard/templates/app/execution.html');
  const order = ['"created"', '"started"', '"ended"', '"duration"', '>Running for<', '"logging"', '"environment"', '"lsn"']
    .map(marker => detail.indexOf(marker));
  assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), String(order));
  assert.ok(!detail.includes('Active elapsed (observed)'));
  const base = source('../../dashboard/templates/app/base.html');
  const nav = ['>History<', '{% block navigation %}', 'class="header-meta"', 'data-server-name', 'data-display-timezone', 'data-theme-choice']
    .map(marker => base.indexOf(marker));
  assert.ok(nav.every((position, index) => position > 0 && (index === 0 || position > nav[index - 1])), String(nav));
  assert.ok(!source('../src/render-observations.js').includes('recording: recorded'));
});
