import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { mountDetail } from '../src/render-detail.js';
import { detailTabs, detailFragment, readDetailFragment, defaultDetailTab, executionHref, readOverviewReturn } from '../src/detail-navigation.js';
import { defaultSelection } from '../src/selection.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { deferred } from './fixtures.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';
import { historyMetadata, historyPage } from './history-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const click = (dom, key) => dom.get(key).dispatchEvent(new Event('click', { cancelable: true }));
const settings = () => { const value = historyMetadata(); value.capabilities.events = true;
  value.event_kinds = eventMetadata().event_kinds; return value; };
const reply = (resource, params = {}) => resource.endsWith('/events') ? eventPage(undefined, params)
  : resource.endsWith('/children') ? childPage(undefined, params)
    : resource.endsWith('/executables') ? executablePage(undefined, params)
      : resource === 'history' ? historyPage(undefined, params) : detailResponse('17');
function mounted(t, { metadata = settings(), hash = '', restoreView, prepare = () => {},
  get = async (resource, { params }) => reply(resource, params) } = {}) {
  const dom = detailDOM(), calls = [], reveals = [];
  dom.window.location.hash = hash;
  for (const [tab] of detailTabs) dom.get(`${tab}-toggle`).scrollIntoView = options => {
    reveals.push({ tab, options }); dom.window.scrollTo(0, 850);
  };
  prepare(dom);
  const screen = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/ops/app/', restoreView,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(screen.dispose);
  return { ...dom, screen, calls, reveals };
}

test('detail fragments round-trip only section/category tokens, including unavailable categories', () => {
  for (const [tab] of detailTabs) {
    const value = { tab, ...(tab === 'events' ? { kind: 'all' } : {}) };
    assert.deepEqual(readDetailFragment(detailFragment(value, settings()), settings()), value);
  }
  for (const kind of eventMetadata().event_kinds) {
    const value = { tab: 'events', kind };
    assert.deepEqual(readDetailFragment(detailFragment(value, eventMetadata(false)), eventMetadata(false)), value);
  }
  for (const hash of ['', '#unknown', '#events/', '#events/errors/extra', '#events?q=private',
    '#events/errors?q=private', '#events/%65rrors', '#history/errors', '#events/cursor', 'events']) {
    assert.equal(readDetailFragment(hash, settings()), null, hash);
  }
  assert.throws(() => detailFragment({ tab: 'events', kind: 'private-search' }, settings()));
});

test('failure defaults and explicit tabs respect capabilities and category support', () => {
  assert.deepEqual(defaultDetailTab(null, { code: 4 }, settings()), { tab: 'events', kind: 'errors' });
  for (const code of [2, 3, 6, 7, -1]) assert.deepEqual(defaultDetailTab(null, { code }, settings()), { tab: 'executables' });
  assert.deepEqual(defaultDetailTab({ tab: 'history' }, { code: 4 }, settings()), { tab: 'history' });
  assert.deepEqual(defaultDetailTab({ tab: 'events' }, { code: 7 }, settings()), { tab: 'events', kind: 'all' });
  const off = settings(); off.capabilities.events = off.capabilities.values = false;
  for (const tab of ['events', 'parameters', 'overrides']) {
    assert.deepEqual(defaultDetailTab({ tab }, { code: 4 }, off), { tab: 'executables' });
  }
});

test('event deep links retain exact overview selection and application prefix without protected state', () => {
  const metadata = settings(), selection = { ...defaultSelection(metadata), folder: 'Folder + /', created: '24h' };
  const options = { metadata, appBase: '/ops/app/', origin: 'https://example.test' };
  for (const kind of ['errors', 'warnings']) {
    const href = executionHref('17', { ...selection, q: 'private', cursor: 'secret' },
      { ...options, section: { tab: 'events', kind } });
    const url = new URL(href, options.origin);
    assert.equal(url.hash, `#events/${kind}`);
    assert.deepEqual(readOverviewReturn(url.search, options).selection, selection);
    assert.doesNotMatch(href, /private|secret|cursor/);
  }
});

test('mounted success defaults to Executables; refresh reads base plus only the active tab', async t => {
  const dom = mounted(t); await flush();
  assert.deepEqual(dom.calls.map(call => call.resource), ['executions/17', 'executions/17/executables']);
  assert.equal(dom.window.location.hash, '#executables');
  click(dom, 'children-toggle'); await flush();
  assert.equal(dom.calls.at(-1).resource, 'executions/17/children');
  assert.equal(dom.get('executables-panel').hidden, true);
  assert.doesNotMatch(dom.body.textContent, /Task/);
  assert.equal(dom.get('children-panel').hidden, false);
  const count = dom.calls.length; click(dom, 'children-toggle'); await flush();
  assert.equal(dom.calls.length, count, 'Selecting the current tab adds no request');
  click(dom, 'detail-refresh'); await flush();
  assert.deepEqual(dom.calls.slice(count).map(call => call.resource), ['executions/17', 'executions/17/children']);
  assert.equal(dom.window.history.replacements.length, 2, 'Refresh adds no history mutation');
});

test('failed detail opens Events/Errors with one section request and explicit fragments win', async t => {
  for (const hash of ['', '#children', '#events/warnings']) {
    const dom = mounted(t, { hash, get: async (resource, { params }) => {
      const response = reply(resource, params);
      if (resource === 'executions/17') response.data.status = { code: 4, name: 'failed' };
      return response;
    } }); await flush();
    assert.equal(dom.calls.length, 2);
    assert.equal(dom.calls[1].resource, hash === '#children' ? 'executions/17/children' : 'executions/17/events');
    if (hash !== '#children') assert.equal(dom.calls[1].params.kind, hash ? 'warnings' : 'errors');
  }
});

test('disabled tabs remain visible with hints, never request data and cannot restore disabled pages', async t => {
  const metadata = settings(); metadata.capabilities.events = metadata.capabilities.values = false;
  const dom = mounted(t, { metadata, hash: '#events/errors', restoreView: { executionId: '17',
    activeTab: { tab: 'events', kind: 'errors' }, events: { open: true, query: { kind: 'errors' } } } });
  await flush();
  for (const key of ['events', 'parameters', 'overrides']) {
    assert.equal(dom.get(`${key}-toggle`).disabled, true);
    assert.equal(dom.get(`${key}-toggle`).hidden, false);
    assert.equal(dom.get(`${key}-unavailable`).hidden, false);
    click(dom, `${key}-toggle`);
  }
  click(dom, 'detail-refresh'); await flush();
  assert.deepEqual(dom.calls.map(call => call.resource), ['executions/17', 'executions/17/executables',
    'executions/17', 'executions/17/executables']);
  assert.equal(dom.field('errors').getAttribute('href'), null);
});

test('tab arrow/Home/End operation skips disabled tabs and exposes one roving focus stop', async t => {
  const dom = mounted(t, { metadata: eventMetadata(false) }); await flush();
  const key = async (tab, value) => {
    const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value });
    dom.get(`${tab}-toggle`).dispatchEvent(event); assert.equal(event.defaultPrevented, true); await flush();
  };
  await key('executables', 'ArrowRight');
  assert.equal(dom.document.activeElement, dom.get('children-toggle'));
  assert.equal(dom.window.location.hash, '#children');
  await key('children', 'End'); assert.equal(dom.window.location.hash, '#history');
  await key('history', 'ArrowRight'); assert.equal(dom.window.location.hash, '#executables');
  await key('executables', 'ArrowLeft'); assert.equal(dom.window.location.hash, '#history');
  await key('history', 'Home'); assert.equal(dom.window.location.hash, '#executables');
  for (const [tab] of detailTabs) {
    assert.equal(dom.get(`${tab}-toggle`).getAttribute('aria-selected'), String(tab === 'executables'));
    assert.equal(dom.get(`${tab}-toggle`).tabIndex, tab === 'executables' ? 0 : -1);
  }
});

test('detail counts select exact categories and clear applied search without exposing it in fragment/history', async t => {
  const dom = mounted(t, { hash: '#events' }); await flush();
  dom.get('events-q').value = 'private search'; dom.get('events-filters').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush(); assert.equal(dom.calls.at(-1).params.q, 'private search');
  for (const [field, kind] of [['errors','errors'], ['warnings','warnings'], ['duplicate_warnings','duplicate-warnings'], ['memory_warnings','memory-warnings'], ['all','all']]) {
    const count = dom.calls.length;
    dom.field(field).dispatchEvent(new Event('click', { cancelable: true })); await flush();
    assert.equal(dom.calls.length, count + 1);
    assert.equal(dom.calls.at(-1).params.kind, kind); assert.equal(dom.calls.at(-1).params.q, null);
    assert.equal(dom.window.location.hash, kind === 'all' ? '#events' : `#events/${kind}`);
    assert.equal(dom.document.activeElement, dom.get('events-toggle'));
    assert.deepEqual(dom.reveals.at(-1), { tab: 'events', options: { behavior: 'instant', block: 'start', inline: 'nearest' } });
  }
  assert.doesNotMatch(JSON.stringify(dom.window.history), /private search|cursor/);
});

test('arrival fragments reveal the selected tab once, without animation or extra reads', async t => {
  for (const hash of ['#events/errors', '#children']) {
    const section = deferred();
    const dom = mounted(t, { hash, get: async (resource, { params }) => resource === 'executions/17'
      ? reply(resource, params) : section.promise });
    await flush();
    assert.deepEqual(dom.reveals, [{ tab: hash.slice(1).split('/')[0],
      options: { behavior: 'instant', block: 'start', inline: 'nearest' } }]);
    assert.equal(dom.document.activeElement, dom.document.body, 'Arrival must not steal focus');
    assert.equal(dom.calls.length, 2);
    section.resolve(reply(dom.calls[1].resource, dom.calls[1].params)); await flush();
    assert.equal(dom.reveals.length, 1, 'A later page response must not reveal again');
    click(dom, 'detail-refresh'); await flush();
    assert.equal(dom.reveals.length, 1, 'Refresh must keep the current view');
  }
});

test('defaults, ordinary tab clicks and unavailable or invalid fragments do not reveal', async t => {
  for (const hash of ['', '#unknown', '#events/errors']) {
    const metadata = settings(); if (hash === '#events/errors') metadata.capabilities.events = false;
    const dom = mounted(t, { metadata, hash, get: async (resource, { params }) => {
      const response = reply(resource, params);
      if (resource === 'executions/17') response.data.status = { code: 4, name: 'failed' };
      return response;
    } }); await flush();
    click(dom, 'children-toggle'); await flush();
    assert.equal(dom.reveals.length, 0);
    assert.equal(dom.window.scrollY, 0);
  }
});

test('explicit navigation respects movement before mounting and during a delayed base read', async t => {
  for (const movement of ['before-mount', 'scroll', 'scroll-away-and-back', 'focus']) {
    const base = deferred();
    const dom = mounted(t, { hash: '#events/errors', prepare: dom => {
      if (movement === 'before-mount') dom.window.scrollY = 120;
    }, get: async (resource, { params }) => resource === 'executions/17' ? base.promise : reply(resource, params) });
    if (movement === 'scroll') dom.window.scrollY = 120;
    if (movement === 'scroll-away-and-back') {
      dom.window.scrollY = 120; dom.window.dispatchEvent(new Event('scroll')); dom.window.scrollY = 0;
    }
    if (movement === 'focus') dom.get('detail-refresh').focus();
    base.resolve(detailResponse('17')); await flush();
    assert.equal(dom.reveals.length, 0, movement);
    assert.equal(dom.window.scrollY, ['before-mount', 'scroll'].includes(movement) ? 120 : 0);
  }
});

test('hash changes reveal only the newest available target; invalid changes do not reveal', async t => {
  const base = deferred();
  const dom = mounted(t, { hash: '#events/errors',
    get: async (resource, { params }) => resource === 'executions/17' ? base.promise : reply(resource, params) });
  dom.window.location.hash = '#children'; dom.window.dispatchEvent(new Event('hashchange'));
  base.resolve(detailResponse('17')); await flush();
  assert.deepEqual(dom.reveals.map(item => item.tab), ['children']);
  assert.deepEqual(dom.calls.map(call => call.resource), ['executions/17', 'executions/17/children']);
  const count = dom.calls.length;
  dom.window.location.hash = '#events/warnings'; dom.window.dispatchEvent(new Event('hashchange')); await flush();
  assert.deepEqual(dom.reveals.map(item => item.tab), ['children', 'events']);
  assert.equal(dom.calls.length, count + 1);
  assert.equal(dom.calls.at(-1).params.kind, 'warnings');
  dom.window.location.hash = '#invalid'; dom.window.dispatchEvent(new Event('hashchange')); await flush();
  assert.equal(dom.reveals.length, 2);
});

test('count navigation reveals even an unchanged category and preserves modified link activation', async t => {
  const section = deferred();
  const dom = mounted(t, { hash: '#events/warnings', get: async (resource, { params }) => resource.endsWith('/events')
    ? section.promise : reply(resource, params) }); await flush();
  const count = dom.calls.length, reveals = dom.reveals.length;
  const modified = new Event('click', { cancelable: true }); Object.defineProperty(modified, 'ctrlKey', { value: true });
  dom.field('errors').dispatchEvent(modified); await flush();
  assert.equal(modified.defaultPrevented, false);
  assert.equal(dom.reveals.length, reveals); assert.equal(dom.calls.length, count);
  dom.field('warnings').focus();
  dom.field('warnings').dispatchEvent(new Event('click', { cancelable: true })); await flush();
  assert.equal(dom.calls.length, count, 'The unchanged category must not add a read');
  assert.equal(dom.reveals.length, reveals + 1);
  assert.equal(dom.document.activeElement, dom.get('events-toggle'));
  section.resolve(eventPage(undefined, { kind: 'warnings' })); await flush();
  assert.equal(dom.reveals.length, reveals + 1, 'Completion must not take the view back');
});

test('retained view restoration overrides arrival reveal and disposed navigation cannot reveal later', async t => {
  const dom = mounted(t, { hash: '#events/errors', restoreView: { executionId: '17',
    position: { x: 0, y: 240 }, activeTab: { tab: 'events', kind: 'errors' }, focus: 'refresh' } });
  await flush();
  assert.equal(dom.window.scrollY, 240); assert.equal(dom.reveals.length, 0);
  assert.equal(dom.document.activeElement, dom.get('detail-refresh'));
  const base = deferred();
  const disposed = mounted(t, { hash: '#children', get: async () => base.promise });
  disposed.screen.dispose(); base.resolve(detailResponse('17')); await flush();
  disposed.window.location.hash = '#events/errors'; disposed.window.dispatchEvent(new Event('hashchange'));
  assert.equal(disposed.reveals.length, 0); assert.equal(disposed.calls.length, 1);
});

test('event rows visibly distinguish error/task-failure/warning while keyed refresh clears obsolete severity', async t => {
  let changed = false;
  const dom = mounted(t, { hash: '#events', get: async (resource, { params }) => resource.endsWith('/events')
    ? eventPage(['OnError','OnTaskFailed','OnWarning','OnInformation'].map((event_name, index) =>
      eventRow(String(index + 1), { event_name: changed ? 'OnInformation' : event_name })), params) : reply(resource, params) });
  await flush();
  assert.deepEqual(dom.eventBody.children.map(row => row.dataset.severity), ['error','error','warning','none']);
  const first = dom.eventBody.firstChild; changed = true; click(dom, 'detail-refresh'); await flush();
  assert.equal(dom.eventBody.firstChild, first); assert.equal(first.dataset.severity, 'none');
});

test('fragment changes select a single section, normalize invalid input and preserve Overview return query', async t => {
  const dom = mounted(t); await flush();
  dom.window.location.search = '?overview=%3Fcreated%3D24h';
  dom.window.location.hash = '#events/warnings'; dom.window.dispatchEvent(new Event('hashchange')); await flush();
  assert.equal(dom.calls.at(-1).params.kind, 'warnings');
  assert.match(dom.window.history.replacements.at(-1), /#executables$/);
  dom.window.location.hash = '#unknown/private'; dom.window.dispatchEvent(new Event('hashchange')); await flush();
  assert.equal(dom.window.location.hash, '#executables');
  assert.equal(dom.window.location.search, '?overview=%3Fcreated%3D24h');
  const count = dom.calls.length;
  dom.window.location.hash = '#invalid'; dom.window.dispatchEvent(new Event('hashchange')); await flush();
  assert.equal(dom.window.location.hash, '#executables'); assert.equal(dom.calls.length, count);
});

test('switching a pending section aborts it and late denial cannot clear the new tab or execution', async t => {
  const wait = deferred();
  const dom = mounted(t, { hash: '#events', get: (resource, { params }) => resource.endsWith('/events')
    ? wait.promise : Promise.resolve(reply(resource, params)) });
  await flush(); const old = dom.calls.at(-1);
  click(dom, 'children-toggle'); await flush();
  assert.equal(old.signal.aborted, true); assert.equal(dom.calls.at(-1).resource, 'executions/17/children');
  wait.reject(new ApiError('http', { status: 404 })); await flush();
  assert.equal(dom.field('package').textContent, 'Main.dtsx');
  assert.equal(dom.get('children-panel').hidden, false); assert.equal(dom.get('events-panel').hidden, true);
});

test('selection during delayed base refresh replaces its pending section without a second base request', async t => {
  const wait = deferred(); let bases = 0;
  const dom = mounted(t, { get: (resource, { params }) => resource === 'executions/17' && ++bases === 2
    ? wait.promise : Promise.resolve(reply(resource, params)) });
  await flush(); click(dom, 'detail-refresh'); click(dom, 'children-toggle');
  wait.resolve(detailResponse('17')); await flush();
  assert.deepEqual(dom.calls.map(call => call.resource), ['executions/17','executions/17/executables',
    'executions/17','executions/17/children']);
});

test('retained active tab refetches base and that tab only, retaining search draft in memory', async t => {
  const first = mounted(t, { hash: '#events/errors' }); await flush();
  first.get('events-q').value = 'private draft'; first.get('detail-poll-toggle').dispatchEvent(new Event('click'));
  const saved = first.screen.checkpoint(); first.screen.dispose();
  assert.deepEqual(saved.activeTab, { tab: 'events', kind: 'errors' });
  assert.doesNotMatch(JSON.stringify(saved), /literal|source_name|Main\.dtsx/);
  const next = mounted(t, { restoreView: saved }); await flush();
  assert.deepEqual(next.calls.map(call => call.resource), ['executions/17','executions/17/events']);
  assert.equal(next.get('events-kind').value, 'errors'); assert.equal(next.get('events-q').value, 'private draft');
  assert.equal(next.window.location.hash, '#events/errors');
  assert.equal(next.get('detail-poll-toggle').textContent, 'Resume auto refresh');
});

test('tab switches and retained return preserve the active event cursor, applied query and separate draft', async t => {
  const get = async (resource, { params }) => resource.endsWith('/events')
    ? eventPage([eventRow(params.cursor ? '2' : '1')], { ...params,
      has_more: !params.cursor, next_cursor: params.cursor ? null : 'event-next' }) : reply(resource, params);
  const first = mounted(t, { hash: '#events/errors', get }); await flush();
  first.get('events-q').value = 'applied secret';
  first.get('events-filters').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  click(first, 'events-next'); await flush();
  assert.equal(first.calls.at(-1).params.cursor, 'event-next');
  first.get('events-q').value = 'unapplied draft';
  click(first, 'children-toggle'); await flush(); click(first, 'events-toggle'); await flush();
  assert.equal(first.calls.at(-1).params.cursor, 'event-next');
  assert.equal(first.calls.at(-1).params.q, 'applied secret');
  assert.equal(first.get('events-q').value, 'unapplied draft');
  const saved = first.screen.checkpoint(); first.screen.dispose();
  const next = mounted(t, { restoreView: saved, get }); await flush();
  assert.equal(next.calls.length, 2);
  assert.equal(next.calls[1].params.cursor, 'event-next'); assert.equal(next.calls[1].params.q, 'applied secret');
  assert.equal(next.get('events-q').value, 'unapplied draft');
  assert.doesNotMatch(JSON.stringify(next.window.history), /applied|secret|event-next/);
});

test('breadcrumb renders literal authorized identity, scoped links and clears it on execution denial', async t => {
  let denied = false;
  const dom = mounted(t, { get: async (resource, { params }) => {
    if (resource === 'executions/17' && denied) throw new ApiError('http', { status: 403 });
    const response = reply(resource, params);
    if (resource === 'executions/17') response.data.folder_name = '<Folder> + /';
    return response;
  } }); await flush();
  const folder = dom.root.querySelector('[data-detail-breadcrumb="folder"]');
  assert.equal(folder.textContent, '<Folder> + /');
  assert.equal(new URL(folder.href, dom.window.location.origin).searchParams.get('folder'), '<Folder> + /');
  denied = true; click(dom, 'detail-refresh'); await flush();
  assert.equal(folder.textContent, '\u2014'); assert.equal(folder.getAttribute('href'), null);
});

test('tab loader selects the newest fragment even before the first base detail resolves', async t => {
  const pending = deferred(), calls = [], states = [];
  const loader = createDetailLoader({ executionId: '17', metadata: settings(), initialTab: {}, autoRefresh: false,
    publish: value => states.push(value), api: { async get(resource, { params }) {
      calls.push(resource); return resource === 'executions/17' ? pending.promise : reply(resource, params);
    } } }); t.after(loader.dispose);
  const loading = loader.load(); await loader.selectTab({ tab: 'events', kind: 'warnings' });
  pending.resolve(detailResponse('17')); await loading;
  assert.deepEqual(calls, ['executions/17','executions/17/events']);
  assert.equal(states.at(-1).events.query.kind, 'warnings');
});
