import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { preprocessCSS, resolveConfig } from 'vite';
import { mountFilters } from '../src/filters.js';
import { statusChoiceOrder } from '../src/overview-screen.js';
import { mountThemeChoice } from '../src/ui.js';
import { envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';

const cssPath = fileURLToPath(new URL('../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const settled = () => new Promise(resolve => setImmediate(resolve));

function storage({ fail = false, initial = {} } = {}) {
  const values = new Map(Object.entries(initial));
  const guard = () => { if (fail) throw new Error('storage blocked'); };
  return { values, getItem: key => { guard(); return values.has(key) ? values.get(key) : null; },
    setItem: (key, value) => { guard(); values.set(key, String(value)); }, removeItem: key => { guard(); values.delete(key); } };
}
function themeDOM(localStorage) {
  const attributes = new Map();
  const html = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    getAttribute: key => attributes.get(key) ?? null };
  const window = Object.assign(new EventTarget(), { localStorage });
  const document = { documentElement: html, defaultView: window };
  const select = Object.assign(new EventTarget(), { value: 'system' });
  const root = { ownerDocument: document, querySelector: selector => selector === '[data-theme-choice]' ? select : null };
  return { root, html, window, select };
}
const choose = (dom, value) => { dom.select.value = value; dom.select.dispatchEvent(new Event('change')); };

test('F2-2: the theme choice applies, remembers and clears Light/Dark, and System removes both', () => {
  const store = storage({ initial: { 'sd-theme': 'dark' } }), dom = themeDOM(store);
  const dispose = mountThemeChoice(dom.root);
  assert.equal(dom.html.getAttribute('data-theme'), 'dark'); assert.equal(dom.select.value, 'dark');
  choose(dom, 'light');
  assert.equal(dom.html.getAttribute('data-theme'), 'light'); assert.equal(store.values.get('sd-theme'), 'light');
  choose(dom, 'system');
  assert.equal(dom.html.getAttribute('data-theme'), null); assert.equal(store.values.has('sd-theme'), false);
  // Another tab's choice is followed; an unknown stored value means System.
  const event = Object.assign(new Event('storage'), { key: 'sd-theme', newValue: 'dark' });
  dom.window.dispatchEvent(event);
  assert.equal(dom.html.getAttribute('data-theme'), 'dark'); assert.equal(dom.select.value, 'dark');
  dom.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'sd-theme', newValue: 'sepia' }));
  assert.equal(dom.html.getAttribute('data-theme'), null); assert.equal(dom.select.value, 'system');
  dispose();
  choose(dom, 'dark');
  assert.equal(dom.html.getAttribute('data-theme'), null, 'Disposed listeners no longer apply choices');
});

test('F2-2: blocked storage still applies the choice for the page and never throws', () => {
  const dom = themeDOM(storage({ fail: true }));
  mountThemeChoice(dom.root);
  assert.equal(dom.select.value, 'system');
  choose(dom, 'dark');
  assert.equal(dom.html.getAttribute('data-theme'), 'dark');
});

for (const [label, path] of [['source', '../src/theme-init.js'], ['packaged', '../../dashboard/static/app/theme-init.js']]) {
  test(`F2-2: ${label} theme-init.js applies saved Light/Dark, tolerates blocked storage and flags older browsers`, t => {
    const file = new URL(path, import.meta.url);
    if (label === 'packaged' && !existsSync(file)) {
      t.skip('Packaged theme-init.js is missing. Run npm --prefix web run build.');
      return;
    }
    const script = readFileSync(file, 'utf8');
    const Current = class {}, Old = class {};
    Object.defineProperty(Current.prototype, 'command', { value: '' });
    for (const [stored, theme] of [['dark', 'dark'], ['light', 'light'], ['sepia', null], [null, null], [undefined, null]]) {
      const localStorage = storage({ fail: stored === undefined, initial: stored ? { 'sd-theme': stored } : {} });
      for (const [HTMLButtonElement, unsupported] of [[Current, null], [Old, ''], [undefined, '']]) {
        const attributes = new Map();
        const context = { window: { localStorage, HTMLButtonElement },
          document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } } };
        vm.runInNewContext(script, context, { filename: fileURLToPath(file) });
        assert.equal(attributes.get('data-theme') ?? null, theme, String(stored));
        assert.equal(attributes.get('data-browser-unsupported') ?? null, unsupported, String(HTMLButtonElement?.name));
        assert.deepEqual(Object.keys(context), ['window', 'document']);
      }
    }
  });
}

test('the Baseline 2025 browser notice becomes visible when theme-init.js flags the browser', () => {
  const html = readFileSync(new URL('../../dashboard/templates/app/base.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="browser-notice" data-browser-notice hidden>[^<]*143[^<]*146[^<]*26\.2[^<]*<\/p>/);
  // The global [hidden] rule is !important, so the notice rule must be too.
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /:root\[data-browser-unsupported\] \[data-browser-notice\] \{ display: block !important;/);
});

test('F2-1: each colour token is one light-dark() pair, a manual choice only fixes color-scheme, and no literal colour sits outside the tokens', () => {
  const tokens = css.match(/:root \{([^}]*)\}/);
  assert.ok(tokens);
  const declarations = block => block.split(';').map(line => line.trim()).filter(Boolean);
  const colour = /#[0-9a-f]{3,8}\b|rgba?\(/i, value = String.raw`(?:#[0-9a-f]{6}|rgb\([^),]*\))`;
  const colours = declarations(tokens[1]).filter(line => colour.test(line));
  assert.ok(colours.length > 20);
  for (const line of colours) assert.match(line, new RegExp(String.raw`^--sd-[\w-]+: light-dark\(${value}, ${value}\)$`, 'i'));
  assert.ok(declarations(tokens[1]).includes('color-scheme: light dark'));
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: light; \}/);
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: dark; \}/);
  // Any other color-scheme would flip the light-dark() tokens inside that element.
  assert.equal(css.match(/color-scheme:/g).length, 3);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  const rest = css.slice(css.indexOf(tokens[0]) + tokens[0].length);
  assert.doesNotMatch(rest, colour);
  assert.doesNotMatch(css, /#fff(fff)?\b|#000(000)?\b|\bwhite\b(?!-space)|\bblack\b/i);
});

function expandIs(selector) {
  const index = selector.findIndex(part => part.type === 'pseudo-class' && part.kind === 'is');
  if (index === -1) return [selector];
  return selector[index].selectors.flatMap(branch => expandIs([...selector.slice(0, index), ...branch, ...selector.slice(index + 1)]));
}

test('F2-3/F2-4/F2-5: wide content cap, auto-fit summary strip, shared status tokens and lighter dense values', async () => {
  assert.match(css, /\.header-content, main \{\s*max-width: 120rem;/);
  assert.match(css, /\.detail-fields \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(10rem, 1fr\)\);/);
  assert.match(css, /\.id-cell, \.time-cell, td\.number-cell \{[^}]*font-weight: 400;/);
  const checks = [
    ['.status-badge', { color: 'other', background: 'other-soft' }],
    ['.chart-frame g', { '--chart-color': 'other' }],
    ['[data-chart-status="4"]::before', { background: 'failed' }],
    ['.metric-other::before', { background: 'other' }],
  ];
  for (const [status, token] of [[2, 'running'], [7, 'succeeded'], [4, 'failed'], [6, 'failed'], [5, 'pending'], [8, 'pending']]) {
    checks.push([`.status-badge[data-status="${status}"]`, { color: token, background: `${token}-soft` }],
      [`.chart-frame g[data-status="${status}"]`, { '--chart-color': token }]);
  }
  // Parse the lookup selectors along with the stylesheet so whitespace and quoting do not affect the comparison.
  const probes = checks.map(([selector]) => `${selector} { --probe: 1 }`).join('\n');
  let rules;
  const config = await resolveConfig({ configFile: false, css: { transformer: 'lightningcss', lightningcss: {
    visitor: { StyleSheet(sheet) { rules = sheet.rules.filter(rule => rule.type === 'style').map(rule => rule.value); } },
  } } }, 'serve');
  await preprocessCSS(`${css}\n${probes}`, cssPath, config);
  const probeRules = rules.splice(-checks.length);
  const styles = new Map();
  for (const rule of rules) {
    for (const selector of rule.selectors.flatMap(expandIs)) {
      const key = JSON.stringify(selector);
      styles.set(key, [...(styles.get(key) ?? []), rule.declarations]);
    }
  }
  for (const [index, [selector, expected]] of checks.entries()) {
    const matching = styles.get(JSON.stringify(probeRules[index].selectors[0])) ?? [];
    const declarations = [...matching.flatMap(rule => rule.declarations), ...matching.flatMap(rule => rule.importantDeclarations)];
    for (const [property, token] of Object.entries(expected)) {
      const declaration = declarations.findLast(({ property: kind, value }) => kind === property
        || value?.propertyId?.property === property || (kind === 'custom' && value.name === property));
      assert.equal(declaration?.value?.value?.[0]?.value?.name?.ident, `--sd-status-${token}`, `${selector} ${property}`);
    }
  }
});

test('F2-6: status choices list Running, Succeeded and Failed first, others in code order', () => {
  const statuses = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(code => ({ code, name: `s${code}` }));
  assert.deepEqual(statusChoiceOrder(statuses).map(item => item.code), [2, 7, 4, 1, 3, 5, 6, 8, 9]);
  assert.deepEqual(statuses.map(item => item.code), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'The metadata list is not mutated');
});

test('F2-6: ArrowDown/ArrowUp move from the folder search through its choices and back', async t => {
  const settings = metadata(), dom = filtersDOM(settings, '');
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/app/', effectiveWindow: () => null, onApplied: () => {},
    api: { get: async (kind, { params }) => ({ ...envelope(['A', 'B'].map((name, i) => ({ folder_id: String(i + 1), name, description: null }))),
      meta: { ...envelope().meta, from: null, to: null, limit: params.limit, sort: 'name', direction: 'asc', has_more: false, next_cursor: null } }) } });
  t.after(() => filters.dispose());
  dom.open('folder'); await settled();
  const search = dom.get('#folder-search'), choices = dom.get('[data-catalog-choices="folder"]');
  const key = (node, name, target = node) => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: name }); Object.defineProperty(event, 'target', { value: target });
    node.dispatchEvent(event); return event;
  };
  assert.equal(key(search, 'ArrowDown').defaultPrevented, true);
  assert.equal(dom.document.activeElement, choices.children[0]);
  key(choices, 'ArrowDown', choices.children[0]); assert.equal(dom.document.activeElement, choices.children[1]);
  key(choices, 'ArrowDown', choices.children[1]); assert.equal(dom.document.activeElement, choices.children[1], 'The last choice stays focused');
  key(choices, 'ArrowUp', choices.children[1]); key(choices, 'ArrowUp', choices.children[0]);
  assert.equal(dom.document.activeElement, search);
});

const templates = new URL('../../dashboard/templates/app/', import.meta.url);
const readTemplate = name => readFileSync(new URL(name, templates), 'utf8');
const overview = readTemplate('index.html'), historyPanel = readTemplate('history-panel.html');

test('G2: the selection rule applies to buttons and leaves text inputs, links, cells and status text selectable', () => {
  const nonSelectable = [...css.matchAll(/([^{}]+)\{[^{}]*\buser-select:\s*none\b[^{}]*\}/g)];
  assert.deepEqual(nonSelectable.map(rule => rule[1].trim()), ['button']);
});

test('G3: auto popovers have headings without close buttons and keep their named actions', () => {
  for (const file of readdirSync(templates).filter(name => name.endsWith('.html'))) {
    const html = readTemplate(file);
    const autoPopovers = html.match(/\bpopover="auto"/g) ?? [];
    const headings = [...html.matchAll(/popover="auto"[^>]*>\s*<div class="popover-heading">([^]*?)<\/div>/g)];
    assert.equal(headings.length, autoPopovers.length, file);
    for (const [, heading] of headings) assert.match(heading, /^<h2\b[^>]*>[^<]+<\/h2>$/);
    assert.doesNotMatch(html, /data-(?:close-filter|history-close)|aria-label="Close [^"]*picker"/);
  }
  assert.match(overview, /data-status-done popovertarget="status-picker" popovertargetaction="hide">Done<\/button>/);
  assert.match(overview, /data-cancel-range popovertarget="created-picker" popovertargetaction="hide">Cancel<\/button>/);
  assert.match(overview, /data-use-range>Use range<\/button>/);
  assert.match(historyPanel, /<button type="submit" data-history-apply>Done<\/button>/);
});

test('B1/B2/B6 CSS keeps detail times intact, gates sticky headers by fit, and shares the Reset row with the tip', () => {
  const wide = css.match(/@media \(min-width: 66\.67rem\) \{([\s\S]*?)\n\}/)[1];
  assert.match(wide, /\[data-execution-table\] th:not\(:nth-child\(2\), :nth-child\(3\), \.count-cell\) \{ width: 1%; \}/);
  assert.match(wide, /\.time-cell \{ min-width: 0; max-width: 11\.5rem; \}/);
  assert.match(wide, /\[data-history-table\] col:is\(:nth-child\(1\), :nth-child\(6\)\) \{ width: auto; \}/);
  assert.doesNotMatch(wide, /executables|children/);
  assert.match(css, /\[data-children-table\] col:nth-child\(3\) \{ width: 12\.5rem; \}/);
  assert.match(css, /@media \(max-width: 66\.6667rem\)[\s\S]*?\.time-cell \{ min-width: 5\.6rem; white-space: normal; \}/);
  assert.match(css, /@media \(min-width: 49\.4rem\)[\s\S]*?\[data-sticky-toolbar\] \{ position: sticky; top: 0;/);
  assert.match(css, /\[data-sticky-table\]\[data-fits\] \{ overflow-x: clip; \}/);
  assert.match(css, /\[data-sticky-table\]\[data-fits\] thead th \{[^}]*top: var\(--sd-list-toolbar-height,[^}]*background: var\(--sd-subtle\)/);
  assert.match(css, /\.filter-meta \{[^}]*flex: 1; justify-content: end;/);
  assert.doesNotMatch(css, /\.filter-meta \{[^}]*flex-basis: 100%/);
});

test('Overview sorts in run column order and History has a separate trailing Status header', () => {
  const template = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const overview = template('index').match(/<table data-execution-table>[\s\S]*?<thead>([\s\S]*?)<\/thead>/)[1];
  assert.deepEqual([...overview.matchAll(/\('([a-z_]+)','([^']+)'\)/g)].map(match => match.slice(1)), [
    ['execution_id', 'ID'], ['project_name', 'Project'], ['package_name', 'Entry package'],
    ['created_at', 'Created'], ['started_at', 'Started'], ['duration_seconds', 'Duration'],
    ['warning_count', 'Warn'], ['error_count', 'Err'], ['status', 'Status'],
  ]);
  assert.match(overview, /key in \('warning_count', 'error_count'\) %\} class="number-cell count-cell"/);
  assert.match(overview, /<th scope="col" aria-sort="none"[^\n]+<button type="button" data-sort="\{\{ key \}\}" disabled>/);
  assert.match(css, /\.count-cell \{ width: (\d+(?:\.\d+)?rem); min-width: \1; max-width: \1;/);
  assert.match(css, /tr:is\(\[data-status="4"\], \[data-status="6"\]\) > td:first-child/);
  const history = template('history-panel');
  assert.deepEqual([...history.matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>|<span class="info-label">)?([A-Za-z]+)/g)]
    .map(match => match[1]),
    ['Execution', 'Created', 'Started', 'Ended', 'Duration', 'Estimate', 'Status']);
  assert.match(history, /<colgroup>(<col>){7}<\/colgroup>/);
  assert.match(history, /<td colspan="7">/);
});

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

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

test('the page reserves its scrollbar gutter and disclosure styles follow expanded state', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /:root\s*\{[^}]*scrollbar-gutter:\s*stable\s*;/);
  for (const key of ['history-chart', 'timeline']) {
    assert.ok(css.includes(`[data-${key}-toggle][aria-expanded="true"]`));
    assert.ok(!css.includes(`[data-${key}-toggle][aria-pressed=`));
  }
});

test('native templates retain only row/timeline disclosures and one pager per toolbar', () => {
  const read = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const overview = read('index'), detail = read('execution').replace('{% include "app/history-panel.html" %}',
    read('history-panel')), controls = read('controls');
  assert.equal((overview.match(/<details/g) ?? []).length, 2); assert.match(overview, /<details data-timeline-values>/);
  // UX batch B3 (O7): the only other disclosure is Advanced exact timestamps inside the Created popover.
  assert.match(overview, /<details class="exact-times"><summary>Advanced: exact timestamps<\/summary>/);
  assert.ok(overview.indexOf('<details class="exact-times"') > overview.indexOf('id="created-picker"')
    && overview.indexOf('<details class="exact-times"') < overview.indexOf('data-use-range'));
  assert.doesNotMatch(detail, /<details|data-history-chart-choice|data-history-direction|data-events-scope/);
  assert.equal((detail.match(/{{ pager\(/g) ?? []).length, 6);
  assert.match(controls, /class="info-trigger" aria-label="{{ label }}" aria-describedby="{{ id }}"/);
  assert.match(controls, /role="tooltip"/); assert.match(controls, /aria-hidden="true" focusable="false"/);
  assert.doesNotMatch(overview + detail, /resource-feedback|status-slot|table-footer|More sort options|How estimates work/);
});

const bodyKeys = { executables: 'body', children: 'childBody', events: 'eventBody',
  parameters: 'parameterBody', overrides: 'overrideBody', history: 'historyBody' };

test('native templates put live feedback in existing toolbars and a single page status', () => {
  const template = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const detail = template('execution').replace('{% include "app/history-panel.html" %}', template('history-panel'));
  const overview = template('index');
  assert.doesNotMatch(detail + overview, /resource-feedback|status-slot|detail-state|More sort options|Choose statuses|Chart key/);
  for (const resource of Object.keys(bodyKeys)) {
    assert.match(detail, new RegExp(`class="toolbar-meta"><span[^>]*data-${resource}-notice role="status"></span><p[^>]*data-${resource}-status role="status"></p><button[^>]*data-${resource}-retry hidden>Retry</button>`));
  }
  assert.match(detail, /data-detail-poll-status data-detail-status role="status"/);
  assert.doesNotMatch(detail, /data-detail-retry|data-detail-request-id|event-search-hint|data-events-scope/);
  assert.doesNotMatch(overview, /data-cohort-window/);
  assert.match(overview, /data-cohort-tip-window/);
  assert.match(overview, /data-execution-scroll data-loading/);
  assert.match(overview, /data-poll-status data-summary-status role="status"/);
});
