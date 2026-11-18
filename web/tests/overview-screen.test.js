import assert from 'node:assert/strict';
import test from 'node:test';

import { mountOverviewScreen } from '../src/overview-screen.js';
import { filtersDOM } from './filters-dom.js';
import { envelope, jsonResponse, trackStorageWrites, wireTime } from './fixtures.js';
import { Node, overviewDOM } from './overview-dom.js';
import { overviewPage, timelineFrom, timelineMetadata, timelinePage, timelineSummary, timelineTo } from './timeline-fixture.js';

const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => setImmediate(resolve)); };
const metadata = timelineMetadata();

// One page from the two existing doubles: the list double supplies the root and document, the filter double
// supplies the form, order controls and sort headers. Wiring evidence only; no browser or layout claims.
function screenDOM(search = '') {
  const list = overviewDOM(), filters = filtersDOM(metadata, search);
  const { root, document } = list, window = filters.window, find = root.querySelector;
  Object.assign(window, { scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } });
  Object.assign(document, { defaultView: window, location: window.location,
    getElementById: id => id === 'app-config'
      ? { textContent: JSON.stringify({ api_base: '/dashboard/api/v1/', app_base: '/dashboard/app/' }) } : null });
  const extra = new Map(['retry', 'request-id', 'display-timezone', 'server-name']
    .map(key => [`[data-${key}]`, new Node(document, key === 'retry' ? 'button' : 'p')]));
  extra.set('#overview-filters fieldset', filters.get('fieldset'));
  extra.set('[data-reset-filters]', filters.get('[data-reset-filters]'));
  // The page nests each checkbox in a label; the filter double lists the checkboxes themselves.
  extra.set('[data-status-choices]', { replaceChildren: (...labels) => {
    filters.get('#status').children = labels.map(label => {
      assert.deepEqual([label.tag, ...label.children.map(node => node.tag)], ['label', 'input', '#text']);
      return Object.assign(label.children[0], { label: label.textContent });
    });
  } });
  const order = ['sort', 'direction', 'limit'].map(key => filters.root.querySelector(`[data-order="${key}"]`));
  root.querySelector = selector => extra.get(selector) ?? find(selector) ?? filters.root.querySelector(selector);
  root.querySelectorAll = selector => selector === '[data-order]' ? order : filters.root.querySelectorAll(selector);
  return { root, window, list, filters, order, header: key => filters.root.querySelector(`[data-sort="${key}"]`),
    statuses: () => filters.get('#status').children };
}

function serve(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const resource = url.pathname.replace('/dashboard/api/v1/', ''), params = Object.fromEntries(url.searchParams);
    calls.push({ resource, params });
    if (resource === 'meta') return jsonResponse(envelope(metadata));
    if (resource === 'server') return jsonResponse(envelope({ server_name: 'Server' }));
    if (resource === 'folders') return jsonResponse({ ...envelope([{ folder_id: '1', name: 'Folder', description: null }]),
      meta: { ...envelope().meta, from: null, to: null, limit: Number(params.limit), sort: 'name', direction: 'asc',
        has_more: false, next_cursor: null } });
    const bounds = { from: params.from ?? timelineFrom, to: params.to ?? timelineTo };
    if (resource === 'executions') return jsonResponse(overviewPage({ ...bounds, sort: params.sort ?? 'execution_id',
      direction: params.direction ?? 'desc', limit: Number(params.limit ?? 50) }));
    if (resource === 'metrics/summary') return jsonResponse(timelineSummary(bounds));
    return jsonResponse(timelinePage(undefined, bounds));
  });
  return { calls, lists: () => calls.filter(call => call.resource === 'executions') };
}

async function mounted(t, saved, search, state = null) {
  const dom = screenDOM(search), api = serve(t);
  dom.window.history.state = state;
  const screen = mountOverviewScreen(dom.root, saved);
  t.after(screen.dispose);
  return { dom, api, screen };
}

test('controls stay disabled and nothing is saved until settings load; then the list is read once', async t => {
  const { dom, api, screen } = await mounted(t);
  const early = [dom.filters.get('fieldset'), dom.filters.get('[data-reset-filters]'), dom.list.get('overview-refresh'),
    dom.list.get('poll-toggle'), ...dom.order];
  assert.deepEqual(early.map(node => node.disabled), early.map(() => true));
  assert.equal(screen.checkpoint(), null);
  await settle();
  assert.equal(dom.root.dataset.startup, 'ready');
  assert.equal(dom.filters.get('fieldset').disabled, false);
  assert.deepEqual(api.calls.map(call => call.resource), ['meta', 'server', 'executions', 'metrics/summary']);
  assert.equal(dom.list.body.children.length, 1);
  assert.notEqual(screen.checkpoint(), null);
});

test('status choices come from the settings, common statuses first, with only All statuses ticked', async t => {
  const { dom } = await mounted(t);
  await settle();
  assert.deepEqual(dom.statuses().map(node => [node.value, node.checked, node.label, node.type, node.name]), [
    ['', true, 'All statuses', 'checkbox', 'status'], ['2', false, 'Running', 'checkbox', 'status'],
    ['7', false, 'Succeeded', 'checkbox', 'status'], ['4', false, 'Failed', 'checkbox', 'status'],
    ['1', false, 'Created', 'checkbox', 'status']]);
});

test('an address the filters reject leaves the list empty and the untouched choices as built', async t => {
  const { dom, api } = await mounted(t, null, '?sort=unknown');
  await settle();
  assert.equal(dom.filters.get('fieldset').disabled, true);
  assert.equal(dom.filters.get('[data-recover-filters]').hidden, false);
  assert.equal(api.lists().length, 0);
  // The filters never drew a selection here, so the ticked box is the one the screen built.
  assert.deepEqual(dom.statuses().filter(node => node.checked).map(node => node.value), ['']);
});

test('Overview records pause and resume on the current entry and carries the pause into a selection change', async t => {
  const entry = { other: { marker: 'overview' } };
  const { dom, screen } = await mounted(t, null, '?limit=25#main-content', entry);
  const { history, location } = dom.window;
  const writes = trackStorageWrites(dom.window);
  const toggle = () => dom.list.get('poll-toggle').dispatchEvent(new Event('click'));
  await settle();
  const beforePause = location.href;
  toggle();
  assert.deepEqual(history.state, { ...entry, autoRefreshPaused: true });
  assert.equal(history.replacements.at(-1), beforePause);
  assert.equal(location.href, beforePause);
  assert.deepEqual(history.pushes, []);
  dom.header('created_at').click();
  await settle();
  assert.equal(screen.checkpoint().view.autoPaused, true);
  assert.deepEqual(history.pushes, ['/dashboard/app/?sort=created_at&limit=25#main-content']);
  assert.deepEqual(history.state, { autoRefreshPaused: true });
  const beforeResume = location.href;
  toggle();
  assert.deepEqual(history.state, { autoRefreshPaused: false });
  assert.equal(history.replacements.at(-1), beforeResume);
  assert.equal(location.href, beforeResume);
  assert.deepEqual(writes, []);
});

test('fresh Overview reads only a boolean entry pause and filter URL replacements preserve it', async t => {
  for (const state of [null, { autoRefreshPaused: 'true' }, { autoRefreshPaused: 1 },
    { autoRefreshPaused: false }, { autoRefreshPaused: true, other: 'overview' }]) {
    const { dom, screen } = await mounted(t, null, '?limit=050#main-content', state);
    await settle();
    assert.equal(screen.checkpoint().view.autoPaused, state?.autoRefreshPaused === true);
    assert.equal(dom.window.location.search, '');
    assert.equal(dom.window.location.hash, '#main-content');
    assert.deepEqual(dom.window.history.state, state);
    assert.deepEqual(dom.window.history.replacements, ['/dashboard/app/#main-content']);
    screen.dispose();
  }
  const state = { autoRefreshPaused: true, other: 'overview' };
  const { dom, screen } = await mounted(t, null, '?sort=unknown', state);
  await settle();
  dom.filters.click('[data-recover-filters]');
  await settle();
  assert.equal(dom.window.location.search, '');
  assert.deepEqual(dom.window.history.state, state);
  assert.deepEqual(dom.window.history.pushes, []);
  assert.equal(screen.checkpoint().view.autoPaused, true);
});

test('a filter-side change reaches the list, and a list-side change goes back through the filters', async t => {
  const { dom, api } = await mounted(t);
  await settle();
  // Filters to list: a sort header belongs to the filters; the list owner makes the request.
  dom.header('created_at').click(); await settle();
  assert.equal(dom.window.location.search, '?sort=created_at');
  assert.deepEqual(api.lists().at(-1).params, { sort: 'created_at', direction: 'desc', limit: '50' });
  // List to filters: a status card belongs to the list; the filters validate it, write the URL and apply it.
  const reads = api.lists().length;
  dom.list.root.querySelector('[data-status-card="failed"]').dispatchEvent(new Event('click', { cancelable: true }));
  await settle();
  assert.equal(dom.window.location.search, '?status=4&sort=created_at');
  assert.equal(api.lists().length, reads + 1);
  assert.deepEqual(api.lists().at(-1).params, { status: '4', sort: 'created_at', direction: 'desc', limit: '50' });
  assert.deepEqual(dom.statuses().filter(node => node.checked).map(node => node.value), ['4']);
});

test('the Created filter opens on the window the list is showing', async t => {
  const { dom } = await mounted(t);
  await settle();
  dom.filters.open('created');
  assert.deepEqual(['#from', '#to'].map(key => dom.filters.get(key).value), [timelineFrom, timelineTo]);
});

test('a saved checkpoint is handed to the list once and then emptied', async t => {
  const first = await mounted(t);
  await settle();
  first.dom.header('created_at').click(); await settle();
  const saved = first.screen.checkpoint();
  assert.equal(saved.paths.length, 2);
  assert.equal(saved.view.autoPaused, false);
  const keys = saved.paths.map(([key]) => key);
  first.screen.dispose();
  saved.view.autoPaused = true;
  saved.view.position = { x: 0, y: 240, left: 0, top: 0 };
  // The restarted document has the same address, so the filters apply it as a restore.
  const second = await mounted(t, saved, '?sort=created_at', { autoRefreshPaused: false });
  await settle();
  // Request paths and view state were consumed, so a later settings reload cannot replay them.
  assert.deepEqual(saved, { paths: [], view: null });
  // The filters' restore option reached the list: the saved page position was put back.
  assert.equal(second.dom.window.scrollY, 240);
  const again = second.screen.checkpoint();
  assert.equal(again.view.autoPaused, true);
  // The restarted screen only read the restored order, so the other path can only have come from what was saved.
  assert.deepEqual(second.api.lists().map(call => call.params.sort), ['created_at']);
  assert.deepEqual(again.paths.map(([key]) => key).sort(), [...keys].sort());
  assert.deepEqual(second.dom.window.history.state, { autoRefreshPaused: false });
  second.dom.header('created_at').click();
  await settle();
  assert.deepEqual(second.dom.window.history.state, { autoRefreshPaused: true }, 'new entries use the live pause');
  second.screen.dispose();
  again.view.autoPaused = false;
  const third = await mounted(t, again, '?sort=created_at', { autoRefreshPaused: true });
  await settle();
  assert.equal(third.screen.checkpoint().view.autoPaused, false);
});

test('both sides get the API client, the application path and the server clock', async t => {
  // The server clock runs on with elapsed time; hold the elapsed time still so the instants are exact.
  t.mock.method(performance, 'now', () => 0);
  const { dom, api } = await mounted(t, null, '?created=24h');
  await settle();
  // Server clock to the list: a relative range is resolved from the settings response time, not the browser's.
  assert.deepEqual([api.lists()[0].params.from, api.lists()[0].params.to], ['2026-10-16T16:00:00.1234567Z', wireTime]);
  // Application path to the list (row links) and to the filters (the address they write).
  assert.match(dom.list.body.children[0].children[0].children[0].href, /^\/dashboard\/app\/executions\/1\?/);
  dom.header('created_at').click(); await settle();
  assert.equal(dom.window.location.pathname + dom.window.location.search, '/dashboard/app/?sort=created_at&created=24h');
  // API client to the filters: opening a catalog filter reads through the same client.
  dom.filters.open('folder'); await settle();
  assert.equal(api.calls.at(-1).resource, 'folders');
  assert.equal(dom.filters.get('[data-catalog-choices="folder"]').children.length, 1);
});

test('disposing the screen stops both sides', async t => {
  const { dom, api, screen } = await mounted(t);
  await settle();
  screen.dispose();
  const reads = api.calls.length;
  assert.deepEqual(dom.order.map(node => node.disabled), [true, true, true]);
  dom.header('created_at').click();
  dom.list.root.querySelector('[data-status-card="failed"]').dispatchEvent(new Event('click', { cancelable: true }));
  dom.list.get('overview-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(api.calls.length, reads);
  assert.equal(dom.window.location.search, '');
});
