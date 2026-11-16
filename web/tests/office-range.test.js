import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mountFilters } from '../src/filters.js';
import { rangeLabel } from '../src/time-range.js';
import { filtersDOM } from './filters-dom.js';
import { envelope, metadata } from './fixtures.js';

function mount(t, hours = 24, maximum = 4320) {
  const settings = metadata();
  settings.limits = { ...settings.limits, default_range_hours: hours, max_range_hours: maximum };
  const dom = filtersDOM(settings), applied = [];
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    onApplied: selection => applied.push(selection), api: { get: async () => envelope([]) } });
  t.after(filters.dispose);
  return { ...dom, applied, settings, filters };
}

for (const [hours, label, pressed] of [[24, 'Last 24 hours', '24h'], [168, 'Last 7 days', '7d'],
  [360, 'Last 15 days', null], [25, 'Last 25 hours', null], [720, 'Last 30 days', '30d'], [4320, 'Last 180 days', '180d']]) {
  test(`B5 ${hours} default hours: trigger label, matching pressed preset and absent range URL`, t => {
    const dom = mount(t, hours);
    assert.equal(rangeLabel(dom.applied[0], 'Europe/London', hours), label);
    assert.equal(dom.get('[data-filter-label="created"]').textContent, label);
    assert.equal(dom.get('[data-open-filter="created"]').getAttribute('aria-label'), `Created: ${label}`);
    dom.get('[data-open-filter="created"]').click();
    const buttons = dom.form.querySelectorAll('[data-created-preset]');
    assert.deepEqual(buttons.map(button => button.dataset.createdPreset), ['today', '24h', '7d', '30d', '180d', 'custom']);
    assert.deepEqual(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')
      .map(button => button.dataset.createdPreset), pressed ? [pressed] : []);
    assert.equal(dom.document.activeElement, dom.get('[data-created-preset="today"]'));
    assert.equal(dom.get('[data-created-preset="default"]'), null);
    assert.equal(dom.applied[0].created, null);
    assert.equal(dom.applied[0].from, null);
    assert.equal(dom.applied[0].to, null);
    assert.equal(dom.window.location.search.includes('created='), false);
  });
}

test('B5 explicit preset selection and Reset keep the existing URL semantics and pressed state', t => {
  const dom = mount(t);
  dom.get('[data-open-filter="created"]').click();
  dom.get('[data-created-preset="7d"]').click();
  assert.equal(dom.applied.at(-1).created, '7d');
  assert.equal(dom.window.location.search, '?created=7d');
  dom.get('[data-open-filter="created"]').click();
  assert.equal(dom.get('[data-created-preset="7d"]').getAttribute('aria-pressed'), 'true');
  dom.get('[data-reset-filters]').click();
  assert.equal(dom.window.location.search, '');
  assert.equal(dom.get('[data-filter-label="created"]').textContent, 'Last 24 hours');
  dom.get('[data-open-filter="created"]').click();
  assert.equal(dom.get('[data-created-preset="24h"]').getAttribute('aria-pressed'), 'true');
});

test('B5 empty custom range reports the concise error and never applies it', t => {
  const dom = mount(t);
  dom.get('[data-open-filter="created"]').click();
  dom.get('[data-created-preset="custom"]').click();
  dom.get('[data-use-range]').click();
  assert.equal(dom.get('[data-time-notice]').textContent, 'Choose at least one date.');
  assert.equal(dom.applied.length, 1);
  assert.equal(dom.get('[data-created-preset="custom"]').getAttribute('aria-pressed'), 'true');
});

test('B4 the capped 180-day preset leaves the flow while the remaining presets keep their order', t => {
  const dom = mount(t, 24, 744);
  const buttons = dom.form.querySelectorAll('[data-created-preset]');
  assert.deepEqual(buttons.filter(button => !button.hidden).map(button => button.dataset.createdPreset),
    ['today', '24h', '7d', '30d', 'custom']);
  assert.equal(dom.get('[data-created-preset="180d"]').disabled, true);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.creation-presets \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, max\(10rem, calc\(\(100% - 0\.4rem\) \/ 2\)\)\), 1fr\)\); gap: 0\.4rem; \}/);
  assert.match(css, /\.creation-presets > button \{ white-space: nowrap; \}/);
  assert.match(css, /\.catalog-choice\[aria-pressed="true"\] \{[^}]*background: var\(--sd-action-soft\)/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});
