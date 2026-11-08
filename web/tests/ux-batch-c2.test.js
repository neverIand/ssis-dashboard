import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFilters } from '../src/filters.js';
import { createOverview } from '../src/overview.js';
import { catalogName, defaultSelection, parseSelection, packageNameUnits, SelectionError, selectionParams,
  selectionSearch, validateSelection } from '../src/selection.js';
import { timelineParams, timelineScope } from '../src/timeline.js';
import { envelope, metadata, wireTime } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';

const settings = metadata();
const key = name => Object.defineProperty(new Event('keydown'), 'key', { value: name });
function setup(t, query = '') {
  const dom = filtersDOM(settings, query), applied = [];
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    onApplied: selection => applied.push(selection), api: { get: async (kind, { params }) => ({
      ...envelope([]), meta: { ...envelope().meta, from: null, to: null, limit: params.limit,
        sort: 'name', direction: 'asc', has_more: false, next_cursor: null } }) } });
  t.after(() => filters.dispose());
  return { ...dom, applied, select: filters.select };
}

test('C2: package names use 260 UTF-16 units and round-trip through the URL after folder and project', () => {
  assert.equal(packageNameUnits, 260);
  assert.equal(catalogName('p'.repeat(260), packageNameUnits).length, 260);
  for (const name of ['', 'p'.repeat(261), '😀'.repeat(131), '\ud800', 'x\0y']) {
    assert.throws(() => catalogName(name, packageNameUnits), SelectionError);
  }
  assert.throws(() => catalogName('p'.repeat(129)), SelectionError, 'folder and project stay at 128 units');
  const name = ' 東京/+# ' + '😀'.repeat(126);
  const value = validateSelection({ ...defaultSelection(settings), folder: 'F', project: 'P', package: name }, settings);
  const search = selectionSearch(value, settings);
  assert.deepEqual([...new URLSearchParams(search).keys()], ['folder', 'project', 'package']);
  assert.deepEqual(parseSelection(search, settings), value);
  assert.equal(selectionParams(value).package, name);
  assert.equal(defaultSelection(settings).package, null);
  assert.equal(selectionParams(defaultSelection(settings)).package, null);
  for (const bad of ['?package=', '?package=a&package=b', `?package=${'p'.repeat(261)}`, '?package=%ED%A0%80',
    '?package_pattern=*']) assert.throws(() => parseSelection(bad, settings), SelectionError, bad);
});

test('C2: the Package panel applies an exact name, shows it, keeps it across scope changes and clears it', t => {
  const dom = setup(t, '?folder=F');
  const trigger = dom.get('[data-open-filter="package"]'), input = dom.get('#package-name');
  assert.equal(dom.get('[data-filter-label="package"]').textContent, 'All packages');
  dom.open('package');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(dom.document.activeElement, input);
  assert.equal(dom.get('[data-all-scope="package"]').getAttribute('aria-pressed'), 'true');
  dom.edit('#package-name', 'Load Journals.dtsx');
  input.dispatchEvent(key('Enter'));
  assert.equal(dom.applied.at(-1).package, 'Load Journals.dtsx');
  assert.equal(dom.applied.at(-1).folder, 'F');
  assert.equal(new URLSearchParams(dom.window.location.search).get('package'), 'Load Journals.dtsx');
  assert.equal(dom.get('[data-filter-label="package"]').textContent, 'Load Journals.dtsx');
  assert.equal(trigger.getAttribute('aria-label'), 'Package: Load Journals.dtsx');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.document.activeElement, trigger);

  // Reopening prefills the applied name; the Apply button commits the edited text.
  dom.open('package');
  assert.equal(input.value, 'Load Journals.dtsx');
  assert.equal(dom.get('[data-all-scope="package"]').getAttribute('aria-pressed'), 'false');
  dom.edit('#package-name', 'Other.dtsx'); dom.click('[data-apply-package]');
  assert.equal(dom.applied.at(-1).package, 'Other.dtsx');

  // Folder, project, status, range and order changes keep the package.
  dom.select({ folder: 'G' });
  assert.equal(dom.applied.at(-1).package, 'Other.dtsx'); assert.equal(dom.applied.at(-1).project, null);
  dom.select({ folder: 'G', project: 'P' }); dom.select({ sort: 'created_at', direction: 'asc' });
  dom.click('[data-reset-filters]');
  assert.equal(dom.applied.at(-1).package, 'Other.dtsx');

  // All packages clears it; an empty Apply does the same.
  dom.open('package'); dom.click('[data-all-scope="package"]');
  assert.equal(dom.applied.at(-1).package, null);
  assert.equal(new URLSearchParams(dom.window.location.search).has('package'), false);
  assert.equal(dom.get('[data-filter-label="package"]').textContent, 'All packages');
  dom.select({ package: 'X.dtsx' }); dom.open('package'); dom.edit('#package-name', ''); dom.click('[data-apply-package]');
  assert.equal(dom.applied.at(-1).package, null);
});

test('C2: invalid package text stays in the panel with a message; Escape and Close apply nothing', t => {
  const dom = setup(t, '?package=Keep.dtsx');
  const count = dom.applied.length, search = dom.window.location.search;
  dom.open('package'); dom.edit('#package-name', 'p'.repeat(261)); dom.click('[data-apply-package]');
  assert.equal(dom.applied.length, count); assert.equal(dom.window.location.search, search);
  assert.match(dom.get('[data-package-status]').textContent, /1–260 UTF-16 units/);
  assert.equal(dom.get('[data-filter-panel="package"]').hidden, false);
  dom.edit('#package-name', 'q');
  assert.equal(dom.get('[data-package-status]').textContent, '', 'editing clears the message');
  dom.form.dispatchEvent(Object.defineProperty(new Event('keydown'), 'key', { value: 'Escape' }));
  assert.equal(dom.get('[data-filter-panel="package"]').hidden, true);
  assert.equal(dom.applied.length, count); assert.equal(dom.applied.at(-1).package, 'Keep.dtsx');
  dom.open('package'); assert.equal(dom.get('#package-name').value, 'Keep.dtsx', 'reopening discards the draft');
  assert.equal(dom.get('[data-package-status]').textContent, '');
  dom.edit('#package-name', 'Other.dtsx'); dom.close();
  assert.equal(dom.applied.length, count);
});

test('C2: list, summary and timeline requests carry the same package', async t => {
  const calls = [], from = '2026-10-17T00:00:00.0000000Z', to = '2026-10-18T00:00:00.0000000Z';
  const states = [];
  const owner = createOverview({ metadata: settings, autoRefresh: false, publish: s => states.push(s), api: { async get(resource, { params }) {
    calls.push({ resource, params });
    if (resource === 'executions') return { ...envelope([]), meta: { ...envelope().meta, from, to, as_of: wireTime,
      upper_id: '9223372036854775807', consistency: 'live', limit: params.limit, sort: 'execution_id', direction: 'desc', has_more: false,
      next_cursor: null } };
    return { ...envelope({ total: 0, by_status: [] }), meta: { ...envelope().meta, from, to, status_scope: 'all' } };
  } } });
  t.after(owner.dispose);
  const value = validateSelection({ ...defaultSelection(settings), project: 'P', package: 'Pkg 東京.dtsx', status: [2] }, settings);
  await owner.apply(value);
  assert.deepEqual(calls.map(call => call.resource), ['executions', 'metrics/summary']);
  for (const call of calls) assert.equal(call.params.package, 'Pkg 東京.dtsx', call.resource);
  const page = { meta: { from, to } };
  assert.equal(timelineParams(value, page, 'day').package, 'Pkg 東京.dtsx');
  assert.notEqual(timelineScope(value, page), timelineScope({ ...value, package: null }, page));
});

test('C2 r1: Enter that confirms an input-method candidate does not apply the package', t => {
  const dom = setup(t);
  const count = dom.applied.length, input = dom.get('#package-name');
  dom.open('package'); dom.edit('#package-name', '東京');
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = key('Enter');
    for (const [name, value] of Object.entries(extra)) Object.defineProperty(event, name, { value });
    input.dispatchEvent(event);
    assert.equal(dom.applied.length, count, JSON.stringify(extra));
    assert.equal(dom.get('[data-filter-panel="package"]').hidden, false);
  }
  input.dispatchEvent(key('Enter'));
  assert.equal(dom.applied.at(-1).package, '東京');
});

test('C2 r1: an unedited Apply keeps CR/LF in the applied package name; an edit replaces it', t => {
  for (const name of ['A\r\nB.dtsx', '\n', 'C\rD.dtsx']) {
    const dom = setup(t, '?' + new URLSearchParams({ package: name }));
    assert.equal(dom.applied.at(-1).package, name);
    dom.open('package'); dom.click('[data-apply-package]');
    assert.equal(dom.applied.at(-1).package, name, 'Apply');
    dom.open('package'); dom.get('#package-name').dispatchEvent(key('Enter'));
    assert.equal(dom.applied.at(-1).package, name, 'Enter');
    assert.equal(new URLSearchParams(dom.window.location.search).get('package'), name);
    dom.open('package'); dom.edit('#package-name', 'New.dtsx'); dom.click('[data-apply-package]');
    assert.equal(dom.applied.at(-1).package, 'New.dtsx');
  }
});
