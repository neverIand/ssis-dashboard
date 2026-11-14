import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createHistoryLoader } from '../src/history-loader.js';
import { historyExecutionHref, historySearch, parseHistorySelection, readHistoryReturn } from '../src/history-navigation.js';
import { historyMetadata, historyPage, historyRow } from './history-fixture.js';
import { deferred, envelope, jsonResponse, wireTime } from './fixtures.js';
import { mountHistory } from '../src/render-history.js';
import { mountHistoryScreen } from '../src/history-screen.js';
import { detailDOM } from './detail-fixture.js';
import { Node } from './overview-dom.js';

const metadata = historyMetadata();
const defaults = () => parseHistorySelection('', metadata);
const navigation = { metadata, appBase: '/ops/monitor/app/', origin: 'https://example.test' };
const settle = () => new Promise(resolve => setImmediate(resolve));
const page = (params, changes = {}, rows = [historyRow('5')]) => historyPage(rows, { ...params, ...changes });
function setup(t, get) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const states = [], calls = [];
  const owner = createHistoryLoader({ metadata, selection: defaults(), publish: state => states.push(state),
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(options, calls.length); } } });
  t.after(owner.dispose);
  return { owner, calls, states, get state() { return states.at(-1); } };
}

test('history URL round trips exact literal names and explicit LIKE scope without an execution proxy', () => {
  for (const match of ['exact', 'like']) {
    const selection = { ...defaults(), match, folder: 'all', project: 'A_%[B] + /', package: '😀.dtsx' };
    assert.deepEqual(parseHistorySelection(historySearch(selection, metadata), metadata), selection);
    const href = historyExecutionHref('9007199254740993', selection, navigation);
    const url = new URL(href, navigation.origin);
    assert.equal(url.pathname, '/ops/monitor/app/executions/9007199254740993');
    const returned = readHistoryReturn(url.search, navigation);
    assert.deepEqual(returned.selection, selection);
    assert.equal(new URL(returned.href, navigation.origin).pathname, '/ops/monitor/app/history');
    assert.equal(url.searchParams.has('overview'), false);
    assert.equal(new URLSearchParams(url.searchParams.get('history')).has('cursor'), false);
  }
});

test('history URLs reject duplicate/unknown inputs, malformed encoding, wide text and arbitrary return URLs', () => {
  for (const search of ['?match=other', '?folder=x&folder=y', '?cursor=secret', '?from=x', '?limit=0x32',
    '?limit=201', '?status=1,1', '?package=%FF', '?folder=%', '?folder=' + '界'.repeat(513)]) {
    assert.throws(() => parseHistorySelection(search, metadata), undefined, search);
  }
  for (const search of ['?history=https://evil.invalid', '?history=?cursor=secret', '?history=?folder=x&overview=?']) {
    assert.equal(readHistoryReturn(search, navigation), null);
  }
});

test('independent history pages refresh the current cursor; first-page reset and expired cursors stay bounded', async t => {
  let expire = false;
  const run = setup(t, async ({ params }) => {
    if (expire && params.cursor) { expire = false; throw new ApiError('http', { status: 400, code: 'cursor_expired' }); }
    return page(params, { upper_id: '6', as_of: wireTime, has_more: !params.cursor, next_cursor: params.cursor ? null : 'next' },
      [historyRow(params.cursor ? '4' : '5')]);
  });
  await run.owner.load();
  await run.owner.next();
  assert.equal(run.state.pageNumber, 2);
  await run.owner.refresh();
  assert.equal(run.calls.at(-1).params.cursor, 'next');
  expire = true;
  await run.owner.refresh();
  assert.equal(run.state.pageNumber, 1);
  assert.match(run.state.notice, /expired/);
  assert.equal(run.calls.at(-1).params.cursor, undefined);
  assert.equal(run.state.page.data[0].execution_id, '5');
});

test('scope replacement clears old rows and rejects late denials; mixed-package LIKE rows remain valid', async t => {
  const old = deferred();
  const run = setup(t, ({ params }, count) => count === 1 ? old.promise : Promise.resolve(page(params, {}, [
    historyRow('9', { folder_name: 'Other', package_name: 'Other.dtsx' }), historyRow('8'),
  ])));
  const first = run.owner.load();
  await run.owner.select({ ...defaults(), package: '*Other*' });
  assert.equal(run.calls[0].signal.aborted, true);
  const current = run.state.page;
  old.reject(new ApiError('http', { status: 403 }));
  await first;
  assert.equal(run.state.page, current);
  assert.equal(run.state.page.data.length, 2);
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.poll.mode, 'scheduled');
});

test('transient failure labels retained data; denial clears it and stops automatic retries', async t => {
  let failure = null;
  const run = setup(t, async ({ params }) => { if (failure) throw failure; return page(params); });
  await run.owner.load();
  failure = new ApiError('http', { status: 503 });
  await run.owner.refresh();
  assert.equal(run.state.stale, true);
  assert.equal(run.state.page.data.length, 1);
  failure = new ApiError('http', { status: 403 });
  await run.owner.retry();
  assert.equal(run.state.page, null);
  assert.equal(run.state.poll.mode, 'blocked');
  const calls = run.calls.length;
  t.mock.timers.tick(600000); await settle();
  assert.equal(run.calls.length, calls);
});

test('an expired continuation followed by failed replacement retries page one without a stale cursor/index', async t => {
  let attempt = 0;
  const run = setup(t, async ({ params }) => {
    attempt += 1;
    if (attempt === 3) throw new ApiError('http', { status: 400, code: 'cursor_expired' });
    if (attempt === 4) throw new ApiError('http', { status: 503 });
    return page(params, { has_more: !params.cursor, next_cursor: params.cursor ? null : 'next' });
  });
  await run.owner.load(); await run.owner.next(); await run.owner.refresh();
  assert.equal(run.state.pageNumber, 1);
  assert.equal(run.state.page, null);
  await run.owner.retry();
  assert.equal(run.state.pageNumber, 1);
  assert.equal(run.calls.at(-1).params.cursor, undefined);
  assert.equal(run.state.phase, 'ready');
});

test('standalone exact-name results respect the server catalog collation and display canonical returned names', async t => {
  const run = setup(t, async ({ params }) => page(params));
  await run.owner.select({ ...defaults(), match: 'exact', folder: 'folder 影狼', project: 'PROJECT', package: 'main.dtsx' });
  assert.equal(run.state.phase, 'ready');
  assert.equal(run.state.page.data[0].folder_name, 'Folder 影狼');
});

test('malformed scope navigation and disposal clear observations and abort work without scheduling more reads', async t => {
  const late = deferred();
  const run = setup(t, () => late.promise);
  const request = run.owner.load();
  run.owner.clear();
  assert.equal(run.calls[0].signal.aborted, true);
  assert.equal(run.state.page, null);
  assert.equal(run.state.poll.mode, 'idle');
  await run.owner.load();
  late.resolve(page(defaults())); await request;
  assert.equal(run.state.page, null);
  const calls = run.calls.length;
  run.owner.dispose();
  t.mock.timers.tick(600000); await settle();
  assert.equal(run.calls.length, calls);
});

test('standalone rows show their package identity and provide a validated page-one History return', () => {
  const dom = detailDOM();
  const view = mountHistory(dom.root, { metadata, actions: { toggle() {}, order() {}, retry() {},
    previous() {}, next() {}, latest() {} }, executionId: null,
    navigation: { ...navigation, historySelection: defaults() }, showIdentity: true });
  view.render({ open: true, phase: 'ready', page: page(defaults()), query: defaults(), pageNumber: 1,
    hasPrevious: false, hasNext: false, error: null, stale: false, notice: '' }, false, true);
  assert.match(dom.historyBody.textContent, /Folder 影狼 \/ Project \/ Main.dtsx/);
  const link = dom.historyBody.children[0].children[0].children[0];
  assert.ok(readHistoryReturn(new URL(link.href, navigation.origin).search, navigation));
  view.dispose();
  assert.equal(dom.historyBody.children.length, 0);
});

function screenDOM(t, search) {
  const dom = detailDOM(), extra = new Map(), calls = [];
  const node = (key, tag = 'div') => { const value = new Node(dom.document, tag); extra.set(`[data-${key}]`, value); return value; };
  const form = node('history-scope-form', 'form'), inputs = {};
  for (const key of ['match', 'folder', 'project', 'package']) inputs[key] = new Node(dom.document, 'input');
  form.elements = { namedItem: key => inputs[key] };
  for (const key of ['history-scope', 'history-scope-notice', 'history-poll-status', 'history-results', 'history-mode-note']) node(key);
  for (const key of ['history-refresh', 'history-poll-toggle', 'history-load']) node(key, 'button');
  const query = dom.root.querySelector;
  dom.root.querySelector = selector => extra.get(selector) ?? query(selector);
  Object.assign(dom.window.location, { pathname: '/ops/app/history', search });
  dom.window.history.pushState = (state, title, href) => dom.window.history.replaceState(state, title, href);
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(metadata));
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Server' }));
    return jsonResponse(page(Object.fromEntries(url.searchParams)));
  });
  return { ...dom, inputs, form, calls, notice: extra.get('[data-history-scope-notice]'), extra,
    history: () => calls.filter(call => call.startsWith('/ops/api/v1/history')) };
}

test('an unscoped History entry offers an empty Exact form and waits for Load history', async t => {
  const dom = screenDOM(t, '');
  const screen = mountHistoryScreen(dom.root);
  t.after(screen.dispose);
  await settle();
  assert.deepEqual(dom.calls, ['/ops/api/v1/meta', '/ops/api/v1/server']);
  assert.deepEqual(Object.fromEntries(Object.entries(dom.inputs).map(([key, input]) => [key, input.value])),
    { match: 'exact', folder: '', project: '', package: '' });
  assert.equal(dom.notice.textContent, '');
  assert.equal(dom.historyBody.textContent, 'Enter a package name and choose Load history, or open History from an execution.');
  Object.assign(dom.inputs.match, { value: 'like' });
  for (const key of ['folder', 'project']) dom.inputs[key].value = '*';
  dom.inputs.package.value = 'Main*';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(new URL(dom.history()[0], navigation.origin).searchParams.get('package'), 'Main*');
  assert.equal(dom.window.location.pathname, '/ops/app/history');
  assert.match(dom.window.location.search, /package=Main/);
  Object.assign(dom.window.location, { search: '' });
  dom.window.dispatchEvent(new Event('popstate'));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(dom.inputs.match.value, 'exact');
  assert.equal(dom.inputs.package.value, '');
  assert.equal(dom.historyBody.textContent, 'Enter a package name and choose Load history, or open History from an execution.');
});

test('a scoped or invalid History URL loads or reports it on entry and on Back/Forward', async t => {
  const dom = screenDOM(t, '?match=exact&folder=Folder&project=Project&package=Main.dtsx');
  const screen = mountHistoryScreen(dom.root);
  t.after(screen.dispose);
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(dom.inputs.match.value, 'exact');
  // A fragment-only history entry (same query) is not navigation: no second read.
  dom.window.dispatchEvent(new Event('popstate'));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(dom.inputs.match.value, 'exact');
  Object.assign(dom.window.location, { search: '?match=other' });
  dom.window.dispatchEvent(new Event('popstate'));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.match(dom.notice.textContent, /Invalid history filters/);
  assert.equal(dom.historyBody.textContent, 'Enter a package name and choose Load history, or open History from an execution.');
});
