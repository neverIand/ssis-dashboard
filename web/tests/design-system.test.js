import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { expectStyle, loadStylesheet } from './css-rules.js';
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

test('the Baseline 2025 browser notice becomes visible when theme-init.js flags the browser', async () => {
  const html = readFileSync(new URL('../../dashboard/templates/app/base.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="browser-notice" data-browser-notice hidden>[^<]*143[^<]*146[^<]*26\.2[^<]*<\/p>/);
  // The global [hidden] rule is !important, so the notice rule must be too.
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, '[hidden]', 'display', 'none !important');
  await expectStyle(assert, sheet, ':root[data-browser-unsupported] [data-browser-notice]', 'display', 'block !important');
});

test('F2-1: each colour token is one light-dark() pair, a manual choice only fixes color-scheme, and no literal colour sits outside the tokens', async () => {
  const tokens = css.match(/:root \{([^}]*)\}/);
  assert.ok(tokens);
  const declarations = block => block.split(';').map(line => line.trim()).filter(Boolean);
  const colour = /#[0-9a-f]{3,8}\b|rgba?\(/i, value = String.raw`(?:#[0-9a-f]{6}|rgb\([^),]*\))`;
  const colours = declarations(tokens[1]).filter(line => colour.test(line));
  assert.ok(colours.length > 20);
  for (const line of colours) assert.match(line, new RegExp(String.raw`^--sd-[\w-]+: light-dark\(${value}, ${value}\)$`, 'i'));
  assert.ok(declarations(tokens[1]).includes('color-scheme: light dark'));
  const sheet = await loadStylesheet();
  for (const theme of ['light', 'dark']) await expectStyle(assert, sheet, `:root[data-theme="${theme}"]`, 'color-scheme', theme);
  // Any other color-scheme would flip the light-dark() tokens inside that element.
  assert.deepEqual(sheet.setting('color-scheme').map(rule => rule.selector),
    [':root', ':root[data-theme="light"]', ':root[data-theme="dark"]']);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  const rest = css.slice(css.indexOf(tokens[0]) + tokens[0].length);
  assert.doesNotMatch(rest, colour);
  assert.doesNotMatch(css, /#fff(fff)?\b|#000(000)?\b|\bwhite\b(?!-space)|\bblack\b/i);
});

test('F2-3/F2-4/F2-5: wide content cap, auto-fit summary strip, shared status tokens and lighter dense values', async () => {
  const sheet = await loadStylesheet();
  for (const selector of ['.header-content', 'main']) await expectStyle(assert, sheet, selector, 'max-width', '120rem');
  await expectStyle(assert, sheet, '.detail-fields', 'display', 'grid', { width: 1400 });
  await expectStyle(assert, sheet, '.detail-fields', 'grid-template-columns', 'repeat(auto-fit, minmax(10rem, 1fr))', { width: 1400 });
  for (const selector of ['.time-cell', 'td.number-cell']) await expectStyle(assert, sheet, selector, 'font-weight', '400');
  await expectStyle(assert, sheet, '.id-cell', 'font-weight', '500');
  // One status mapping sets --sd-tone/--sd-tone-soft; badges, chart groups, bars, legends and summary dots read them.
  const tone = { '--sd-tone': 'other', '--sd-tone-soft': 'other-soft' };
  const checks = [['.status-badge', tone], ['.chart-frame g', tone], ['[data-chart-status]', tone], ['.metric-other', tone],
    ['.metric-running', { '--sd-tone': 'running' }],
    ['.metric-succeeded', { '--sd-tone': 'succeeded' }], ['.metric-failed', { '--sd-tone': 'failed' }]];
  for (const [status, token] of [[2, 'running'], [7, 'succeeded'], [4, 'failed'], [6, 'failed'], [5, 'pending'], [8, 'pending']]) {
    const mapped = { '--sd-tone': token, '--sd-tone-soft': `${token}-soft` };
    checks.push([`.status-badge[data-status="${status}"]`, mapped], [`.chart-frame g[data-status="${status}"]`, mapped]);
  }
  for (const status of [2, 4, 5, 7]) {
    checks.push([`[data-chart-status="${status}"]`, { '--sd-tone': { 2: 'running', 4: 'failed', 5: 'pending', 7: 'succeeded' }[status] }]);
  }
  for (const [selector, expected] of checks) {
    for (const [property, token] of Object.entries(expected)) {
      await expectStyle(assert, sheet, selector, property, `var(--sd-status-${token})`);
    }
  }
  for (const [selector, property, value] of [['.status-badge', 'color', 'var(--sd-tone)'],
    ['.status-badge', 'background', 'var(--sd-tone-soft)'], ['.metric-other::before', 'background', 'var(--sd-tone)'],
    ['[data-chart-status]::before', 'background', 'var(--sd-tone)'], ['[data-chart-status]', 'fill', 'var(--sd-tone)'],
    ['.history-duration-plot [data-series="actual"]', 'fill', 'var(--sd-tone)'], ['.chart-frame [data-zero]', 'stroke', 'var(--sd-tone)']]) {
    await expectStyle(assert, sheet, selector, property, value);
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

test('G2: the selection rule applies to buttons and leaves text inputs, links, cells and status text selectable', async () => {
  const sheet = await loadStylesheet();
  // The unprefixed property and Chromium's -webkit- alias, with or without !important.
  const none = value => /^none( |$)/.test(value);
  assert.deepEqual([...new Set([...sheet.setting('user-select', none), ...sheet.setting('-webkit-user-select', none)]
    .map(rule => rule.selector))], ['button']);
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

test('B1/B2/B6 CSS keeps detail times intact, gates sticky headers by fit, and shares the Reset row with the tip', async () => {
  const sheet = await loadStylesheet(), wide = { width: 1400 }, mid = { width: 900 }, phone = { width: 600 };
  // Above 1067 px, spare width goes to the name and estimate columns; observation tables keep their own widths.
  await expectStyle(assert, sheet, '[data-execution-table] th:not(:nth-child(2), :nth-child(3), .count-cell)', 'width', '1%', wide);
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'min-width', '0', wide);
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'max-width', '11.5rem', wide);
  await expectStyle(assert, sheet, '[data-history-table] col:nth-child(1)', 'width', 'auto', wide);
  await expectStyle(assert, sheet, '[data-history-table] col:nth-child(6)', 'width', 'auto', wide);
  // No media query of any width or feature changes the observation tables or shared detail-table columns; their
  // widths are global. Only the History table's own columns and cells change, and only in the wide query.
  const wideQuery = sheet.rules.find(rule => rule.selectors.some(({ text }) => text.startsWith('[data-history-table] col'))
    && rule.context.length)?.media;
  assert.equal(wideQuery, '@media (width >= 66.67rem)');
  assert.deepEqual(sheet.rules.filter(rule => rule.context.length).flatMap(rule => rule.selectors.map(({ text }) => [rule.media, text]))
    .filter(([media, text]) => !(media === wideQuery && text.startsWith('[data-history-table]'))
      && /\[data-(executables|children|history)-table\]|\.detail-table(?![\w-])|(^|[\s>+~(,])col(?![\w-])/.test(text)), []);
  await expectStyle(assert, sheet, '[data-children-table] col:nth-child(3)', 'width', '12.5rem', wide);
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'min-width', '5.6rem', mid);
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'white-space', 'normal', mid);
  await expectStyle(assert, sheet, '[data-sticky-toolbar]', 'position', 'sticky', wide);
  await expectStyle(assert, sheet, '[data-sticky-toolbar]', 'top', '0', wide);
  assert.equal(await sheet.get('[data-sticky-toolbar]', 'position', phone), undefined, 'phones do not stick the toolbar');
  // Both bounds of both gaps (a media-query rem is 16 px): the narrow layout holds through 49.3333rem (789.33 px)
  // and sticky toolbars start at 49.4rem (790.4 px); the mid layout holds through 66.6667rem (1066.67 px) and the
  // wide layout starts at 66.67rem (1066.72 px). Inside each gap neither query of that pair matches.
  const twoColumns = 'repeat(2, minmax(0, 1fr))';
  await expectStyle(assert, sheet, '.detail-fields', 'grid-template-columns', twoColumns, { width: 789.33 });
  assert.notEqual(await sheet.get('.detail-fields', 'grid-template-columns', { width: 790 }), await sheet.value('grid-template-columns', twoColumns));
  assert.equal(await sheet.get('[data-sticky-toolbar]', 'position', { width: 790 }), undefined);
  await expectStyle(assert, sheet, '[data-sticky-toolbar]', 'position', 'sticky', { width: 790.4 });
  await expectStyle(assert, sheet, '[data-execution-table]', 'min-width', '44rem', { width: 1066.66 });
  assert.equal(await sheet.get('[data-execution-table]', 'min-width', { width: 1066.69 }), undefined);
  assert.equal(await sheet.get('[data-execution-table] .time-cell', 'min-width', { width: 1066.69 }), undefined);
  await expectStyle(assert, sheet, '[data-execution-table] .time-cell', 'min-width', '0', { width: 1066.72 });
  await expectStyle(assert, sheet, '[data-sticky-table][data-fits]', 'overflow-x', 'clip', wide);
  await expectStyle(assert, sheet, '[data-sticky-table][data-fits] thead th', 'top', 'var(--sd-list-toolbar-height, 3.0667rem)', wide);
  await expectStyle(assert, sheet, '[data-sticky-table][data-fits] thead th', 'background', 'var(--sd-subtle)', wide);
  for (const options of [phone, wide]) {
    await expectStyle(assert, sheet, '.filter-meta', 'flex', '1', options);
    await expectStyle(assert, sheet, '.filter-meta', 'justify-content', 'end', options);
    assert.equal(await sheet.get('.filter-meta', 'flex-basis', options), undefined);
  }
});

test('Overview sorts in run column order and History has a separate trailing Status header', async () => {
  const template = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const overview = template('index').match(/<table data-execution-table>[\s\S]*?<thead>([\s\S]*?)<\/thead>/)[1];
  assert.deepEqual([...overview.matchAll(/\('([a-z_]+)','([^']+)'\)/g)].map(match => match.slice(1)), [
    ['execution_id', 'ID'], ['project_name', 'Project'], ['package_name', 'Entry package'],
    ['created_at', 'Created'], ['started_at', 'Started'], ['duration_seconds', 'Duration'],
    ['warning_count', 'Warn'], ['error_count', 'Err'], ['status', 'Status'],
  ]);
  assert.match(overview, /key in \('warning_count', 'error_count'\) %\} class="number-cell count-cell"/);
  assert.match(overview, /<th scope="col" aria-sort="none"[^\n]+<button type="button" data-sort="\{\{ key \}\}" disabled>/);
  const sheet = await loadStylesheet(), count = '[data-execution-table] .count-cell';
  const width = await sheet.get(count, 'width');
  assert.match(width, /^[\d.]+rem$/);
  for (const property of ['min-width', 'max-width']) assert.equal(await sheet.get(count, property), width, property);
  for (const status of [4, 6]) {
    assert.ok(await sheet.get(`[data-execution-table] tr[data-status="${status}"] > td:first-child`, 'box-shadow'), status);
  }
  const history = template('history-panel');
  assert.deepEqual([...history.matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>|<span class="info-label">)?([A-Za-z]+)/g)]
    .map(match => match[1]),
    ['Execution', 'Created', 'Started', 'Ended', 'Duration', 'Estimate', 'Status']);
  assert.match(history, /<colgroup>(<col>){7}<\/colgroup>/);
  assert.match(history, /<td colspan="7">/);
});

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('H-03, H-09–H-11, H-14: compact toolbar controls, inline Retry, aligned titles and grouped pagers', async () => {
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, '.toolbar-meta > .inline-status', 'flex', '0 1 auto');
  for (const control of ['.table-toolbar > button', '.toolbar-filters button:not(.info-trigger)', '.table-toolbar select',
    '.table-toolbar input']) {
    await expectStyle(assert, sheet, control, 'height', '2.2rem');
    await expectStyle(assert, sheet, control, 'min-height', '2.2rem');
  }
  await expectStyle(assert, sheet, '.detail-title', 'display', 'flex');
  await expectStyle(assert, sheet, '.detail-title', 'align-items', 'baseline');
  await expectStyle(assert, sheet, '.detail-table th button', 'min-height', '0');
  await expectStyle(assert, sheet, '.table-paging', 'display', 'flex');
  await expectStyle(assert, sheet, '.table-paging', 'margin-left', 'auto');
  const controls = source('../../dashboard/templates/app/controls.html');
  assert.match(controls, /<div class="table-paging">\s*<label class="page-size">/);
});

test('the page reserves its scrollbar gutter and disclosure styles follow expanded state', async () => {
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, ':root', 'scrollbar-gutter', 'stable');
  for (const key of ['history-chart', 'timeline']) {
    await expectStyle(assert, sheet, `[data-${key}-toggle][aria-expanded="true"]`, 'background', 'var(--sd-action-soft)');
    // No rule styles these toggles by aria-pressed, however the selector is written.
    assert.ok(!sheet.rules.some(rule => rule.selectors.some(({ text }) => text.includes(`[data-${key}-toggle`) && text.includes('aria-pressed'))));
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

test('a zero-duration History dot keeps the surface fill: the [data-zero] rule follows the actual-series rule', async () => {
  // The dot is both [data-series="actual"] and [data-zero]; both selectors have the same specificity, so source order decides.
  const sheet = await loadStylesheet();
  const index = selector => sheet.rules.findLastIndex(rule => rule.media === '' && rule.selectors.some(entry => entry.text === selector)
    && rule.declarations.some(declaration => declaration.property === 'fill'));
  const actual = index('.history-duration-plot [data-series="actual"]'), zero = index('.chart-frame [data-zero]');
  assert.ok(actual >= 0 && zero >= 0);
  assert.ok(zero > actual, 'the zero-dot fill must come later');
  await expectStyle(assert, sheet, '.chart-frame [data-zero]', 'fill', 'var(--sd-surface)');
  // Only these rules set fill; a new or more specific one that could reach the dots must update this list.
  assert.deepEqual([...new Set(sheet.setting('fill').map(rule => `${rule.media} ${rule.selector}`.trim()))].sort(), [
    '.chart-frame [data-chart-hit]', '.chart-frame [data-zero]', '.history-duration-plot [data-series="actual"]',
    '[data-chart-status]']);
  // The dot matches both rules: at every width the surface fill wins.
  for (const width of [420, 900, 1400]) {
    await expectStyle(assert, sheet, ['.history-duration-plot [data-series="actual"]', '.chart-frame [data-zero]'], 'fill',
      'var(--sd-surface)', { width });
  }
});
