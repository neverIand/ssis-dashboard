import assert from 'node:assert/strict';
import test from 'node:test';

import { mountHistoryScreen } from '../src/history-screen.js';
import { detailDOM } from './detail-fixture.js';
import { deferred, envelope, jsonResponse } from './fixtures.js';
import { historyMetadata, historyPage, historyRow } from './history-fixture.js';
import { Node } from './overview-dom.js';

const metadata = historyMetadata();
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => setImmediate(resolve)); };
const scoped = '?match=exact&folder=Folder&project=Project&package=Main.dtsx';

test('standalone History keeps the update clock visible during a pending refresh', async t => {
  const pending = deferred();
  let delayed = false;
  const dom = screen(t, scoped, { respond: params => delayed ? pending.promise
    : jsonResponse(historyPage([historyRow('5')], { direction: params.direction, limit: Number(params.limit) })) });
  await settle();
  delayed = true; dom.click('history-refresh'); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.match(dom.get('history-poll-status').title, /auto refresh on/);
  pending.resolve(jsonResponse(historyPage([historyRow('5')]))); await settle();
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00');
  assert.equal(dom.get('history-poll-status').title, 'Updated 17:00:00 · auto refresh on');
});

// The standalone History page on the detail double: wiring evidence only, no browser, focus or layout claims.
function screen(t, search, { saved = null, respond = null, hidden = false } = {}) {
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
  dom.window.history.pushState = (state, title, href) => dom.window.history.replaceState(state, title, href);
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
  assert.equal(dom.get('history-poll-status').title, 'Updated 17:00:00 · auto refresh on');
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
  assert.equal(dom.get('history-poll-status').title, 'Updated 17:00:00 · auto refresh on');
  dom.click('history-poll-toggle'); await settle();
  assert.equal(dom.get('history-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(dom.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused');
  assert.equal(dom.mounted.checkpoint().paused, true);
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
  const second = screen(t, scoped, { saved: { paused: true, view: { ...saved.view, statusOptionsOpen: true, chart: { ...saved.view.chart, open: false } } } });
  await settle();
  assert.equal(second.get('history-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(second.get('history-poll-status').textContent, 'Updated 17:00:00 · auto refresh paused');
  const again = second.mounted.checkpoint();
  assert.equal(again.paused, true);
  assert.equal(again.view.statusOptionsOpen, true);
  assert.equal(again.view.chart.open, false);
  assert.equal(!second.get('history-status-options').matches(':popover-open'), false);
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
