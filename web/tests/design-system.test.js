import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { mountFilters } from '../src/filters.js';
import { statusChoiceOrder } from '../src/overview-screen.js';
import { mountThemeChoice } from '../src/ui.js';
import { envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = source('../src/styles.css');
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

test('F2-2: theme-init.js applies only a saved Light/Dark choice and tolerates blocked storage', () => {
  const script = source('../src/theme-init.js');
  for (const [stored, expected] of [['dark', 'dark'], ['light', 'light'], ['sepia', null], [null, null]]) {
    const attributes = new Map();
    vm.runInNewContext(script, { window: { localStorage: storage({ initial: stored ? { 'sd-theme': stored } : {} }) },
      document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } } });
    assert.equal(attributes.get('data-theme') ?? null, expected, String(stored));
  }
  assert.doesNotThrow(() => vm.runInNewContext(script, { window: { localStorage: storage({ fail: true }) },
    document: { documentElement: { setAttribute() { throw new Error('unexpected'); } } } }));
});

test('theme-init.js marks only a browser without invoker commands as below the Baseline 2025 floor', () => {
  const script = source('../src/theme-init.js');
  const Current = class {}, Old = class {};
  Object.defineProperty(Current.prototype, 'command', { value: '' });
  for (const [HTMLButtonElement, expected] of [[Current, false], [Old, true], [undefined, true]]) {
    const attributes = new Map();
    vm.runInNewContext(script, { window: { localStorage: storage({}), HTMLButtonElement },
      document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } } });
    assert.equal(attributes.has('data-browser-unsupported'), expected, String(HTMLButtonElement?.name));
  }
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

test('F2-3/F2-4/F2-5: wide content cap, auto-fit summary strip, shared status tokens and lighter dense values', () => {
  assert.match(css, /\.header-content, main \{\s*max-width: 120rem;/);
  assert.match(css, /\.detail-fields \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(10rem, 1fr\)\);/);
  for (const [selector, token] of [['.status-badge[data-status="2"]', 'running'], ['.chart-frame g[data-status="7"]', 'succeeded'],
    ['[data-chart-status="4"]::before', 'failed'], ['.metric-other::before { ', 'other']]) {
    assert.ok(css.includes(selector) && css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector))).includes(`--sd-status-${token}`), selector);
  }
  assert.match(css, /\.id-cell, \.time-cell, td\.number-cell \{[^}]*font-weight: 400;/);
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
