import assert from 'node:assert/strict';
import test from 'node:test';

import { mountHistoryScreen } from '../src/history-screen.js';
import { detailDOM } from './detail-fixture.js';
import { deferred, envelope, jsonResponse, trackStorageWrites } from './fixtures.js';
import { historyMetadata, historyPage, historyRow } from './history-fixture.js';
import { Node } from './overview-dom.js';

const metadata = historyMetadata();
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => setImmediate(resolve)); };
const scoped = '?match=exact&folder=Folder&project=Project&package=Main.dtsx';

test('B3 standalone History reveals new pages and Rows while Refresh, sorting and restore keep their position', async t => {
  const dom = screen(t, scoped, { respond: params => jsonResponse(historyPage([historyRow('5')], {
    direction: params.direction, limit: Number(params.limit), has_more: true, next_cursor: 'page-two',
  })) });
  await settle();
  const toolbar = dom.get('history-toolbar'), head = dom.get('history-table').querySelector('thead'), scrolls = [];
  let headerTop = -120;
  dom.window.scrollY = 700;
  toolbar.style.position = 'sticky';
  toolbar.getBoundingClientRect = () => {
    const top = toolbar.style.position === 'static' ? 460 - dom.window.scrollY : 0;
    return { top, bottom: top + 40, height: 40, width: 800 };
  };
  head.getBoundingClientRect = () => ({ top: headerTop, bottom: headerTop + 30 });
  dom.window.scrollTo = request => { scrolls.push(request); dom.window.scrollY = request.top; };
  const next = dom.get('history-next');
  next.focus(); dom.click('history-next'); await settle();
  assert.deepEqual(scrolls, [{ left: 0, top: 460, behavior: 'instant' }]);
  assert.equal(dom.document.activeElement, next);
  headerTop = 40;
  dom.click('history-previous'); await settle();
  assert.equal(scrolls.length, 1, 'visible header needs no scrolling');
  headerTop = 10;
  dom.click('history-latest'); await settle();
  const limit = dom.get('history-limit');
  limit.focus(); limit.value = '25'; limit.dispatchEvent(new Event('change')); await settle();
  assert.equal(scrolls.length, 3);
  assert.equal(dom.history().at(-1).limit, '25');
  assert.equal(dom.document.activeElement, limit);
  dom.click('history-refresh'); await settle();
  dom.click('history-header-execution_id'); await settle();
  assert.equal(scrolls.length, 3);
  const saved = dom.mounted.checkpoint();
  dom.mounted.dispose();
  const restored = screen(t, scoped, { saved });
  restored.window.scrollY = 280;
  restored.get('history-table').querySelector('thead').getBoundingClientRect = () => ({ top: -100, bottom: -70 });
  restored.window.scrollTo = () => assert.fail('retained History must not reveal a page');
  await settle();
  assert.equal(restored.window.scrollY, 280);
});

test('standalone History keeps the update clock visible during a pending refresh', async t => {
  const pending = deferred();
  let delayed = false;
  const dom = screen(t, scoped, { respond: params => delayed ? pending.promise
    : jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit) })) });
  await settle();
  delayed = true; dom.click('history-refresh'); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('history-poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
  pending.resolve(jsonResponse(historyPage([historyRow('5')]))); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('history-poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
});

// The standalone History page on the detail double: wiring evidence only, no browser, focus or layout claims.
function screen(t, search, { saved = null, respond = null, hidden = false, state = null } = {}) {
  const dom = detailDOM(), extra = new Map(), calls = [], held = [];
  const node = (key, tag = 'div') => { const value = new Node(dom.document, tag); extra.set(`[data-${key}]`, value); return value; };
  const form = node('history-scope-form', 'form'), inputs = {};
  for (const key of ['match', 'folder', 'project', 'package']) inputs[key] = new Node(dom.document, key === 'match' ? 'select' : 'input');
  form.elements = { namedItem: key => inputs[key] };
  for (const key of ['history-scope', 'history-scope-notice', 'history-poll-status', 'history-results', 'history-mode-note']) node(key);
  for (const key of ['history-refresh', 'history-poll-toggle', 'history-load']) node(key, 'button');
  // As served: the scope fields and both buttons are disabled until settings load.
  for (const key of ['history-scope', 'history-refresh', 'history-poll-toggle']) extra.get(`[data-${key}]`).disabled = true;
  const query = dom.root.querySelector;
  dom.root.querySelector = selector => extra.get(selector) ?? query(selector);
  Object.assign(dom.window.location, { pathname: '/ops/app/history', search });
  dom.window.history.state = state;
  if (hidden) dom.document.visibilityState = 'hidden';
  // Every listener the screen itself adds to these targets must be removed again on disposal.
  for (const [name, target] of Object.entries({ form, refresh: extra.get('[data-history-refresh]'), toggle: extra.get('[data-history-poll-toggle]'),
    match: inputs.match, window: dom.window, document: dom.document })) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    const capture = rest => Boolean(typeof rest[0] === 'object' ? rest[0]?.capture : rest[0]);
    target.addEventListener = (type, handler, ...rest) => { held.push({ name, type, handler, capture: capture(rest) }); add(type, handler, ...rest); };
    target.removeEventListener = (type, handler, ...rest) => {
      const index = held.findIndex(item => item.name === name && item.type === type && item.handler === handler && item.capture === capture(rest));
      if (index >= 0) held.splice(index, 1); remove(type, handler, ...rest);
    };
  }
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(metadata));
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Server' }));
    const params = Object.fromEntries(url.searchParams);
    return respond?.(params, calls.filter(call => call.includes('/history')).length)
      ?? jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit) }));
  });
  const mounted = mountHistoryScreen(dom.root, saved);
  t.after(mounted.dispose);
  const get = key => extra.get(`[data-${key}]`) ?? dom.get(key);
  const history = () => calls.filter(call => call.includes('/history')).map(call => Object.fromEntries(new URL(call, 'https://example.test').searchParams));
  return { ...dom, mounted, inputs, form, calls, get, history, listeners: () => held.map(item => `${item.name}:${item.type}`), click: key => get(key).dispatchEvent(new Event('click')) };
}

const paged = params => jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit),
  has_more: !params.cursor, next_cursor: params.cursor ? null : 'cursor-two' }));

test('settings enable the scope form; a loaded scope shows its title, identity, status and refresh state', async t => {
  const dom = screen(t, scoped);
  for (const key of ['history-scope', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).disabled, true, key);
  assert.equal(dom.mounted.checkpoint(), null);
  await settle();
  for (const key of ['history-scope', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).disabled, false, key);
  assert.equal(dom.history().length, 1);
  assert.equal(dom.document.title, 'History · Main.dtsx · SSIS Dashboard');
  // Standalone rows name their folder, project and package.
  assert.match(dom.historyBody.textContent, /Folder .* \/ Project \/ Main\.dtsx/);
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('history-poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
  assert.equal(dom.get('history-poll-toggle').getAttribute('aria-label'), 'Pause auto refresh');
  assert.equal(dom.get('history-refresh').getAttribute('aria-disabled'), 'false');
});

test('loading a scope from the form names it in the title; an invalid scope is reported and reads nothing', async t => {
  const dom = screen(t, '');
  await settle();
  assert.equal(dom.document.title, 'History · SSIS Dashboard');
  // Exact names with a wildcard character are allowed but explained.
  dom.inputs.package.value = 'Main*';
  dom.form.dispatchEvent(new Event('input'));
  assert.equal(dom.get('history-scope-notice').textContent, 'Exact names treat * and % as literal characters.');
  dom.inputs.package.value = '';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.match(dom.get('history-scope-notice').textContent, /^Enter valid history names/);
  assert.equal(dom.history().length, 0);
  for (const key of ['folder', 'project', 'package']) dom.inputs[key].value = { folder: 'Folder', project: 'Project', package: 'Main.dtsx' }[key];
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(dom.document.title, 'History · Main.dtsx · SSIS Dashboard');
  // An exact name typed without the extension gets .dtsx; a LIKE pattern is left as typed.
  dom.inputs.package.value = 'Other';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.document.title, 'History · Other.dtsx · SSIS Dashboard');
  assert.equal(dom.inputs.package.value, 'Other.dtsx');
  dom.inputs.match.value = 'like'; dom.inputs.package.value = 'Oth%';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.document.title, 'History · Oth% · SSIS Dashboard');
});

test('History adds .dtsx when a loaded LIKE name is switched to Exact unchanged', async t => {
  const dom = screen(t, '?' + new URLSearchParams({ match: 'like', folder: 'Folder', project: 'Project', package: 'Load' }));
  await settle();
  dom.inputs.match.value = 'exact';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  const params = new URLSearchParams(dom.window.location.search);
  assert.equal(params.get('package'), 'Load.dtsx'); assert.equal(params.get('match'), 'exact');
  const request = new URLSearchParams(dom.calls.filter(call => call.includes('/history')).at(-1).split('?')[1]);
  assert.equal(request.get('package'), 'Load.dtsx'); assert.equal(request.get('match'), 'exact');
});

test('History keeps an exact package name from a link when only the folder changes', async t => {
  const dom = screen(t, '?' + new URLSearchParams({ match: 'exact', folder: 'Folder', project: 'Project', package: 'Legacy' }));
  await settle();
  assert.equal(dom.inputs.package.value, 'Legacy');
  dom.inputs.folder.value = 'Other folder';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(dom.document.title, 'History · Legacy · SSIS Dashboard');
  assert.equal(new URLSearchParams(dom.window.location.search).get('package'), 'Legacy');
});

test('Refresh, Next, Previous, Latest and Retry each do their own read', async t => {
  let fail = false;
  // Three pages: the first has no cursor, then cursor-two and cursor-three.
  const next = { undefined: 'cursor-two', 'cursor-two': 'cursor-three', 'cursor-three': null };
  const dom = screen(t, scoped, { respond: params => fail
    ? jsonResponse({ type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'database_unavailable' }, { status: 503 })
    : jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit),
      has_more: next[params.cursor] !== null, next_cursor: next[params.cursor] })) });
  const cursors = () => dom.history().map(params => params.cursor ?? 'first');
  await settle();
  dom.click('history-next'); await settle();
  dom.click('history-next'); await settle();
  assert.deepEqual(cursors(), ['first', 'cursor-two', 'cursor-three']);
  // On the third page: Refresh rereads it, Previous goes to the second, Latest to the first.
  dom.click('history-refresh'); await settle();
  assert.equal(cursors().at(-1), 'cursor-three');
  dom.click('history-previous'); await settle();
  assert.equal(cursors().at(-1), 'cursor-two');
  dom.click('history-next'); await settle();
  assert.equal(cursors().at(-1), 'cursor-three');
  dom.click('history-latest'); await settle();
  assert.deepEqual(cursors().slice(3), ['cursor-three', 'cursor-two', 'cursor-three', 'first']);
  // After Latest the chain starts again: Next leads to the second page, not the third.
  dom.click('history-next'); await settle();
  assert.equal(cursors().at(-1), 'cursor-two');
  fail = true;
  dom.click('history-refresh'); await settle();
  assert.equal(cursors().at(-1), 'cursor-two');
  const failed = cursors().length;
  fail = false;
  dom.click('history-retry'); await settle();
  assert.deepEqual(cursors().slice(failed), ['cursor-two']);
});

test('while a read is in flight the page is marked busy and Refresh says so', async t => {
  const gate = deferred();
  const dom = screen(t, scoped, { respond: async params => {
    await gate.promise;
    return jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit) }));
  } });
  await settle();
  assert.equal(dom.history().length, 1);
  assert.equal(dom.get('history-refresh').getAttribute('aria-disabled'), 'true');
  assert.equal(dom.get('history-table').getAttribute('aria-busy'), 'true');
  gate.resolve();
  await settle();
  assert.equal(dom.get('history-refresh').getAttribute('aria-disabled'), 'false');
  assert.equal(dom.get('history-table').getAttribute('aria-busy'), 'false');
});

test('the pause button and tab visibility reach the loader, and the pause is what the checkpoint saves', async t => {
  const dom = screen(t, scoped);
  await settle();
  assert.equal(dom.mounted.checkpoint().paused, false);
  dom.document.visibilityState = 'hidden'; dom.document.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused (tab hidden)');
  dom.document.visibilityState = 'visible'; dom.document.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('history-poll-status').title, 'Auto refresh on · Observed 2026-10-17 17:00:00');
  dom.click('history-poll-toggle'); await settle();
  assert.equal(dom.get('history-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused');
  assert.equal(dom.mounted.checkpoint().paused, true);
});

test('standalone History records pause and resume on the current entry and copies it into new scope entries', async t => {
  const entry = { other: 'history' };
  const dom = screen(t, scoped, { state: entry });
  const { history, location } = dom.window;
  const writes = trackStorageWrites(dom.window);
  await settle();
  const beforePause = location.href;
  dom.click('history-poll-toggle');
  assert.deepEqual(history.state, { ...entry, autoRefreshPaused: true });
  assert.equal(history.replacements.at(-1), beforePause);
  assert.equal(location.href, beforePause);
  assert.deepEqual(history.pushes, []);
  const reads = dom.history().length;
  dom.click('history-refresh'); await settle();
  assert.equal(dom.history().length, reads + 1);
  assert.deepEqual(history.state, { ...entry, autoRefreshPaused: true });
  dom.inputs.package.value = 'Other.dtsx';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(location.searchParams.get('package'), 'Other.dtsx');
  assert.deepEqual(history.pushes, [location.pathname + location.search]);
  assert.deepEqual(history.state, { autoRefreshPaused: true });
  assert.equal(dom.mounted.checkpoint().paused, true);
  const beforeResume = location.href;
  dom.click('history-poll-toggle');
  assert.deepEqual(history.state, { autoRefreshPaused: false });
  assert.equal(history.replacements.at(-1), beforeResume);
  assert.equal(location.href, beforeResume);
  assert.deepEqual(writes, []);
});

test('fresh standalone History reads only a boolean pause from its entry', async t => {
  for (const state of [null, { autoRefreshPaused: 'true' }, { autoRefreshPaused: 1 },
    { autoRefreshPaused: false }, { autoRefreshPaused: true }]) {
    const dom = screen(t, scoped, { state });
    await settle();
    const paused = state?.autoRefreshPaused === true;
    assert.equal(dom.history().length, 1);
    assert.equal(dom.mounted.checkpoint().paused, paused);
    assert.equal(dom.get('history-poll-toggle').getAttribute('aria-label'), paused ? 'Resume auto refresh' : 'Pause auto refresh');
    assert.deepEqual(dom.window.history.state, state);
    assert.deepEqual(dom.window.history.replacements, []);
    dom.mounted.dispose();
  }
});

test('a page opened in a hidden tab starts with refresh held', async t => {
  const dom = screen(t, scoped, { hidden: true });
  await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused (tab hidden)');
});

test('a saved checkpoint restores the pause and the view, and disposal leaves nothing to save', async t => {
  const first = screen(t, scoped);
  await settle();
  const saved = first.mounted.checkpoint();
  assert.deepEqual(Object.keys(saved), ['paused', 'view']);
  assert.equal(saved.view.statusOptionsOpen, false);
  assert.equal(saved.view.chart.open, true);
  first.mounted.dispose();
  assert.equal(first.mounted.checkpoint(), null);
  const second = screen(t, scoped, { state: { autoRefreshPaused: false },
    saved: { paused: true, view: { ...saved.view, statusOptionsOpen: true, chart: { ...saved.view.chart, open: false } } } });
  await settle();
  assert.equal(second.get('history-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(second.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused');
  const again = second.mounted.checkpoint();
  assert.equal(again.paused, true);
  assert.equal(again.view.statusOptionsOpen, true);
  assert.equal(again.view.chart.open, false);
  assert.equal(!second.get('history-status-options').matches(':popover-open'), false);
  second.inputs.package.value = 'Other.dtsx';
  second.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(second.window.history.state, { autoRefreshPaused: true }, 'new entries use the live pause');
  const resumed = screen(t, scoped, { saved, state: { autoRefreshPaused: true } });
  await settle();
  assert.equal(resumed.mounted.checkpoint().paused, false);
  // Without a saved checkpoint the same page starts running, with the options closed.
  const fresh = screen(t, scoped);
  await settle();
  assert.equal(fresh.get('history-poll-toggle').getAttribute('aria-label'), 'Pause auto refresh');
  assert.equal(!fresh.get('history-status-options').matches(':popover-open'), true);
});

test('disposal removes every listener the screen added and stops the view and the loader', async t => {
  const dom = screen(t, scoped, { respond: paged });
  await settle();
  for (const name of ['form:submit', 'form:input', 'match:change', 'refresh:click', 'toggle:click', 'window:popstate', 'document:visibilitychange']) {
    assert.ok(dom.listeners().includes(name), name);
  }
  dom.mounted.dispose();
  assert.deepEqual(dom.listeners(), []);
  const reads = dom.calls.length, search = dom.window.location.search;
  dom.inputs.package.value = 'Other.dtsx';
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  for (const key of ['history-refresh', 'history-next', 'history-latest', 'history-poll-toggle']) dom.click(key);
  dom.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(dom.calls.length, reads);
  assert.equal(dom.window.location.search, search);
});

test('a continuation page from a different cohort is refused instead of being shown', async t => {
  for (const other of [{ upper_id: '4' }, { as_of: '2026-10-17T16:00:01.1234567Z' }]) {
    const dom = screen(t, scoped, { respond: params => jsonResponse(historyPage([historyRow(params.cursor ? '4' : '5')], {
      direction: params.direction, limit: Number(params.limit), has_more: !params.cursor, next_cursor: params.cursor ? null : 'cursor-two',
      ...(params.cursor ? other : {}) })) });
    await settle();
    dom.click('history-next'); await settle();
    assert.equal(dom.history().at(-1).cursor, 'cursor-two');
    assert.match(dom.get('history-status').textContent, /^The server returned an unexpected response\. Request ID: /, Object.keys(other)[0]);
    // The other cohort's row is not rendered, and Retry is offered.
    assert.doesNotMatch(dom.historyBody.textContent, /Succeeded/);
    assert.equal(dom.get('history-retry').hidden, false);
  }
});

const rowsMetadata = historyMetadata();
const settleOnce = () => new Promise(resolve => setImmediate(resolve));
function rowsScreen(t, search, rows = () => [historyRow('5')], storage = null) {
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
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(rowsMetadata));
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
  const dom = rowsScreen(t, '');
  await settleOnce();
  assert.equal(dom.history().length, 0);
  assert.equal(dom.get('history-results').getAttribute('data-idle'), '');
  for (const key of ['history-poll-status', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).hidden, true, key);
  assert.match(dom.get('history-mode-note').textContent, /^Exact names/);
  for (const key of ['folder', 'project', 'package']) dom.inputs[key].value = { folder: 'Folder', project: 'Project', package: 'Main.dtsx' }[key];
  dom.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settleOnce();
  assert.equal(dom.history().length, 1);
  assert.equal(new URL(dom.history()[0], 'https://example.test').searchParams.get('match'), 'exact');
  assert.equal(dom.get('history-results').getAttribute('data-idle'), null);
  for (const key of ['history-poll-status', 'history-refresh', 'history-poll-toggle']) assert.equal(dom.get(key).hidden, false, key);
});

test('H2: URLs without match= still mean LIKE, so existing bookmarks keep their scope', async t => {
  const dom = rowsScreen(t, '?package=Main.dtsx');
  await settleOnce();
  assert.equal(dom.inputs.match.value, 'like');
  assert.equal(new URL(dom.history()[0], 'https://example.test').searchParams.get('match'), 'like');
});

test('N1: a status preset applies to the loaded scope, keeps the unapplied draft and says so', async t => {
  const dom = rowsScreen(t, scoped);
  await settleOnce();
  dom.inputs.package.value = 'Draft.dtsx';
  dom.form.dispatchEvent(new Event('input'));
  assert.match(dom.get('history-scope-notice').textContent, /not applied yet/);
  assert.equal(dom.get('history-load').className, 'button-primary');
  const failed = dom.get('history-presets').children.find(button => button.dataset.historyPreset === 'failed');
  failed.dispatchEvent(new Event('click'));
  await settleOnce();
  const sent = new URL(dom.history().at(-1), 'https://example.test').searchParams;
  assert.equal(sent.get('package'), 'Main.dtsx');
  assert.equal(sent.get('status'), '4,6', 'Failed includes ended unexpectedly');
  assert.equal(dom.inputs.package.value, 'Draft.dtsx', 'the draft survives');
  assert.match(dom.get('history-scope-notice').textContent, /not applied yet/);
});

test('N2: switching to Exact clears pure wildcards and explains literal * and %', async t => {
  const dom = rowsScreen(t, '?match=like&folder=*&project=Pro%25&package=*');
  await settleOnce();
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
  const dom = rowsScreen(t, '?match=like&folder=*&project=*&package=Main%25', () => [historyRow('6'),
    historyRow('5', { folder_name: 'Other folder' })]);
  await settleOnce();
  assert.match(dom.get('history-status').textContent, /2 executions on this page · 2 packages$/);
  assert.equal(dom.get('history-chart-panel').hidden, false, 'the chart is open by default on standalone History');
  assert.equal(dom.get('history-chart-count').textContent, '2 runs on this page');
  assert.equal(dom.get('history-chart-mixed').hidden, false);
  assert.match(dom.get('history-chart-mixed').textContent, /^2 packages on this page/);
  const single = rowsScreen(t, scoped);
  await settleOnce();
  assert.equal(single.get('history-chart-mixed').hidden, true);
  assert.doesNotMatch(single.get('history-status').textContent, /packages/);
});

test('H4: the chart choice is remembered, and Enter or double click opens the execution', async t => {
  const store = memory('closed');
  const closed = rowsScreen(t, scoped, undefined, store);
  await settleOnce();
  assert.equal(closed.get('history-chart-panel').hidden, true, 'a stored choice wins');
  closed.get('history-chart-toggle').dispatchEvent(new Event('click'));
  assert.equal(store.data.get('sd-history-chart'), 'open');
  const dom = rowsScreen(t, scoped);
  await settleOnce();
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
  const dom = rowsScreen(t, '');
  await settleOnce();
  dom.get('history-header-execution_id').dispatchEvent(new Event('click'));
  await settleOnce();
  dom.get('history-custom').dispatchEvent(new Event('click'));
  for (const input of dom.get('history-choices').children.map(label => label.firstChild)) input.checked = input.value === '4';
  dom.get('history-filters').dispatchEvent(new Event('submit', { cancelable: true }));
  await settleOnce();
  assert.equal(dom.history().length, 0);
  const invalid = rowsScreen(t, '?match=other');
  await settleOnce();
  invalid.get('history-header-execution_id').dispatchEvent(new Event('click'));
  await settleOnce();
  assert.equal(invalid.history().length, 0);
  assert.match(invalid.get('history-scope-notice').textContent, /^Invalid history link/);
});

test('B4 R1-3: the History tab title follows direct URLs, Back/Forward and the idle page', async t => {
  const dom = rowsScreen(t, scoped);
  await settleOnce();
  assert.equal(dom.document.title, 'History · Main.dtsx · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '' });
  dom.window.dispatchEvent(new Event('popstate')); await settleOnce();
  assert.equal(dom.document.title, 'History · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '?match=exact&folder=F&project=P&package=Other.dtsx' });
  dom.window.dispatchEvent(new Event('popstate')); await settleOnce();
  assert.equal(dom.document.title, 'History · Other.dtsx · SSIS Dashboard');
  Object.assign(dom.window.location, { search: '?match=other' });
  dom.window.dispatchEvent(new Event('popstate')); await settleOnce();
  assert.equal(dom.document.title, 'History · SSIS Dashboard');
});
