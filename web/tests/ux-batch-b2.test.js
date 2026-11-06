import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryScreen } from '../src/history-screen.js';
import { historyMetadata, historyPage, historyRow, estimate } from './history-fixture.js';
import { envelope, jsonResponse } from './fixtures.js';
import { detailDOM } from './detail-fixture.js';
import { Node } from './overview-dom.js';

// UX review 2026-11-05, batch B2: standalone History. URL semantics and request counts are unchanged.
const metadata = historyMetadata();
const settle = () => new Promise(resolve => setImmediate(resolve));
const scoped = '?match=exact&folder=Folder&project=Project&package=Main.dtsx';
function screen(t, search, rows = () => [historyRow('5')], storage = null) {
  const dom = detailDOM(), extra = new Map(), calls = [];
  const node = (key, tag = 'div') => { const value = new Node(dom.document, tag); extra.set(`[data-${key}]`, value); return value; };
  const form = node('history-scope-form', 'form'), inputs = {};
  for (const key of ['match', 'folder', 'project', 'package']) inputs[key] = new Node(dom.document, key === 'match' ? 'select' : 'input');
  form.elements = { namedItem: key => inputs[key] };
  for (const key of ['history-scope', 'history-scope-notice', 'history-poll-status', 'history-results', 'history-mode-note']) node(key);
  for (const key of ['history-refresh', 'history-poll-toggle', 'history-load']) node(key, 'button');
  extra.get('[data-history-results]').setAttribute('data-idle', '');
  const query = dom.root.querySelector;
  dom.root.querySelector = selector => extra.get(selector) ?? query(selector);
  Object.assign(dom.window.location, { pathname: '/ops/app/history', search, assign: href => dom.opened.push(href) });
  dom.window.history.pushState = (state, title, href) => dom.window.history.replaceState(state, title, href);
  if (storage) dom.window.localStorage = storage;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(metadata));
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Server' }));
    const params = Object.fromEntries(url.searchParams);
    return jsonResponse(historyPage(rows(params), { direction: params.direction, limit: Number(params.limit) }));
  });
  dom.opened = [];
  const mounted = mountHistoryScreen(dom.root);
  t.after(mounted.dispose);
  const get = key => extra.get(`[data-${key}]`) ?? dom.get(key);
  return { ...dom, inputs, form, calls, get, history: () => calls.filter(call => call.includes('/history')) };
}
const memory = (value = null) => {
  const data = new Map(value === null ? [] : [['sd-history-chart', value]]);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, item) => data.set(key, item) };
};

test('H1: an unscoped page hides results controls and refresh until a scope is loaded', async t => {
  const dom = screen(t, '');
  await settle();
  assert.equal(dom.history().length, 0);
  assert.equal(dom.get('history-results').getAttribute('data-idle'), '');
  for (const key of ['history-poll-status', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).hidden, true, key);
  assert.match(dom.get('history-mode-note').textContent, /^Exact names/);
  for (const key of ['folder', 'project', 'package']) dom.inputs[key].value = { folder: 'Folder', project: 'Project', package: 'Main.dtsx' }[key];
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(new URL(dom.history()[0], 'https://example.test').searchParams.get('match'), 'exact');
  assert.equal(dom.get('history-results').getAttribute('data-idle'), null);
  for (const key of ['history-poll-status', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).hidden, false, key);
});

test('H2: URLs without match= still mean LIKE, so existing bookmarks keep their scope', async t => {
  const dom = screen(t, '?package=Main.dtsx');
  await settle();
  assert.equal(dom.inputs.match.value, 'like');
  assert.equal(new URL(dom.history()[0], 'https://example.test').searchParams.get('match'), 'like');
});

test('N1: a status preset applies to the loaded scope, keeps the unapplied draft and says so', async t => {
  const dom = screen(t, scoped);
  await settle();
  dom.inputs.package.value = 'Draft.dtsx';
  dom.form.dispatchEvent(new Event('input'));
  assert.match(dom.get('history-scope-notice').textContent, /not applied yet/);
  assert.equal(dom.get('history-load').className, 'button-primary');
  const failed = dom.get('history-presets').children.find(button => button.dataset.historyPreset === 'failed');
  failed.dispatchEvent(new Event('click'));
  await settle();
  const sent = new URL(dom.history().at(-1), 'https://example.test').searchParams;
  assert.equal(sent.get('package'), 'Main.dtsx');
  assert.equal(sent.get('status'), '4');
  assert.equal(dom.inputs.package.value, 'Draft.dtsx', 'the draft survives');
  assert.match(dom.get('history-scope-notice').textContent, /not applied yet/);
});

test('N2: switching to Exact clears pure wildcards and explains literal * and %', async t => {
  const dom = screen(t, '?match=like&folder=*&project=Pro%25&package=*');
  await settle();
  dom.inputs.match.value = 'exact';
  dom.inputs.match.dispatchEvent(new Event('change'));
  assert.equal(dom.inputs.folder.value, '');
  assert.equal(dom.inputs.package.value, '');
  assert.equal(dom.inputs.project.value, 'Pro%', 'a name containing % is kept');
  assert.match(dom.get('history-mode-note').textContent, /^Exact names/);
  assert.match(dom.get('history-scope-notice').textContent, /not applied yet/);
  assert.equal(dom.history().length, 1, 'switching mode sends nothing');
});

test('H2/H5: the page states how many packages it mixes and how many runs the chart plots', async t => {
  const dom = screen(t, '?match=like&folder=*&project=*&package=Main%25', () => [historyRow('6'),
    historyRow('5', { folder_name: 'Other folder' })]);
  await settle();
  assert.match(dom.get('history-status').textContent, /2 executions on this page · 2 packages$/);
  assert.equal(dom.get('history-chart-panel').hidden, false, 'the chart is open by default on standalone History');
  assert.equal(dom.get('history-chart-count').textContent, '2 runs on this page');
  assert.equal(dom.get('history-chart-mixed').hidden, false);
  assert.match(dom.get('history-chart-mixed').textContent, /^2 packages on this page/);
  const single = screen(t, scoped);
  await settle();
  assert.equal(single.get('history-chart-mixed').hidden, true);
  assert.doesNotMatch(single.get('history-status').textContent, /packages/);
});

test('H3: ended rows show the deviation from the estimate; running rows keep the expected end', async t => {
  const dom = screen(t, scoped, () => [
    historyRow('7', { duration_seconds: 30, estimate: estimate({ duration_seconds: 10 }) }),
    historyRow('6', { duration_seconds: 8, estimate: estimate({ duration_seconds: 10 }) }),
    historyRow('5', { status: { code: 2, name: 'running' }, ended_at: null, duration_seconds: null, elapsed_seconds: 3,
      estimate: estimate({ duration_seconds: 10 }) })]);
  await settle();
  const [slow, fast, running] = dom.historyBody.children.map(row => row.children[5]);
  assert.match(slow.textContent, /^10 s · avg of 5 · \+200%$/);
  assert.equal(slow.children[3].dataset.level, 'warning');
  assert.match(fast.textContent, /^10 s · avg of 5 · −20%$/);
  assert.equal(fast.children[3].dataset.level, 'quiet', 'faster runs are not coloured as better');
  assert.match(running.textContent, /^10 s · ends .* · avg of 5$/);
  assert.equal(running.children[3].hidden, true);
});

test('H4: the chart choice is remembered, and Enter or double click opens the execution', async t => {
  const store = memory('closed');
  const closed = screen(t, scoped, undefined, store);
  await settle();
  assert.equal(closed.get('history-chart-panel').hidden, true, 'a stored choice wins');
  closed.get('history-chart-toggle').dispatchEvent(new Event('click'));
  assert.equal(store.data.get('sd-history-chart'), 'open');
  const dom = screen(t, scoped);
  await settle();
  const plot = dom.get('history-chart-plot'), bar = plot.children[0];
  const fire = (type, key) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: bar });
    if (key) Object.defineProperty(event, 'key', { value: key });
    plot.dispatchEvent(event);
  };
  fire('keydown', 'ArrowLeft');
  assert.deepEqual(dom.opened, [], 'arrow keys only select');
  fire('dblclick');
  fire('keydown', 'Enter');
  const href = dom.historyBody.children[0].children[0].children[0].getAttribute('href');
  assert.deepEqual(dom.opened, [href, href]);
  assert.match(href, /\/executions\/5\?history=/);
});

test('R1 (Codex): while idle, header sort, an open Custom popover and an invalid URL cannot start the broad read', async t => {
  const dom = screen(t, '');
  await settle();
  dom.get('history-header-execution_id').dispatchEvent(new Event('click'));
  await settle();
  dom.get('history-custom').dispatchEvent(new Event('click'));
  for (const input of dom.get('history-choices').children.map(label => label.firstChild)) input.checked = input.value === '4';
  dom.get('history-filters').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.history().length, 0);
  const invalid = screen(t, '?match=other');
  await settle();
  invalid.get('history-header-execution_id').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(invalid.history().length, 0);
  assert.match(invalid.get('history-scope-notice').textContent, /^Invalid history filters/);
});

test('B4 R1-3: the History tab title follows direct URLs, Back/Forward and the idle page', async t => {
  const dom = screen(t, scoped);
  await settle();
  assert.equal(dom.document.title, 'History · Main.dtsx · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '' });
  dom.window.dispatchEvent(new Event('popstate')); await settle();
  assert.equal(dom.document.title, 'History · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '?match=exact&folder=F&project=P&package=Other.dtsx' });
  dom.window.dispatchEvent(new Event('popstate')); await settle();
  assert.equal(dom.document.title, 'History · Other.dtsx · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '?match=other' });
  dom.window.dispatchEvent(new Event('popstate')); await settle();
  assert.equal(dom.document.title, 'History · SSIS Dashboard');
});
