import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';

// UX review 2026-11-05, batch B1: the failure path on the execution page. No new request kinds.
const flush = () => new Promise(resolve => setImmediate(resolve));
const failed = (errors = 2) => {
  const response = detailResponse('17');
  response.data.status = { code: 4, name: 'failed' };
  response.data.error_count = errors;
  response.data.event_counts = { ...response.data.event_counts, all: 3 + errors, errors };
  return response;
};
const errorRow = (id, changes = {}) => eventRow(id, { event_name: 'OnError', message_type: 120,
  source_name: 'Data Flow Task', subcomponent_name: 'OLE DB Destination',
  message: `Error ${id}: ${'x'.repeat(300)} TAIL-${id}`, ...changes });
function mounted(t, { metadata = eventMetadata(), hash = '', legacy = '/ops/execution/17', detail = failed(),
  events = params => eventPage([errorRow('1'), errorRow('2')], params), prepare = () => {} } = {}) {
  const dom = detailDOM(), calls = [];
  dom.window.location.hash = hash;
  if (legacy !== null) dom.get('legacy-detail-link').setAttribute('href', legacy);
  prepare(dom);
  const screen = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/ops/app/', api: {
    async get(resource, { params = {} } = {}) {
      calls.push({ resource, params });
      return resource.endsWith('/events') ? events(params) : resource.endsWith('/executables') ? executablePage()
        : resource.endsWith('/children') ? childPage() : detail;
    } } });
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; screen.dispose(); } };
  t.after(dispose);
  return { ...dom, calls, dispose };
}

test('G1: with events disabled, counts and a visible link open legacy event lists by an explicit click only', async t => {
  const dom = mounted(t, { metadata: eventMetadata(false) });
  await flush(); await flush();
  assert.equal(dom.calls.some(call => call.resource.endsWith('/events')), false, 'no event request');
  for (const [field, kind] of [['errors', 'errors'], ['duplicate_warnings', 'duplicate-warnings'], ['all', 'all']]) {
    assert.equal(dom.field(field).getAttribute('href'), `/ops/execution/17/events/${kind}`);
    assert.match(dom.field(field).getAttribute('aria-label'), /legacy view$/);
  }
  const link = dom.get('legacy-errors');
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), '/ops/execution/17/events/errors');
  assert.ok(!link.getAttribute('href').includes('native=1'));
  const click = new Event('click', { cancelable: true });
  dom.field('errors').dispatchEvent(click);
  assert.equal(click.defaultPrevented, false, 'the browser follows the legacy link');
  assert.equal(dom.window.location.hash, '#executables');
  assert.equal(dom.get('first-error').hidden, true);
});

test('G1: the legacy link stays hidden without errors, with events enabled, or without a legacy base', async t => {
  for (const options of [{ metadata: eventMetadata(false), detail: failed(0) }, {}, { metadata: eventMetadata(false), legacy: null }]) {
    const dom = mounted(t, options);
    await flush(); await flush();
    assert.equal(dom.get('legacy-errors').hidden, true, JSON.stringify(Object.keys(options)));
  }
  const dom = mounted(t, { metadata: eventMetadata(false), legacy: null });
  await flush(); await flush();
  assert.equal(dom.field('errors').getAttribute('href'), null);
});

test('D2: only an unsearched, time-ascending first Errors page names the earliest recorded error', async t => {
  const dom = mounted(t);
  await flush(); await flush();
  assert.equal(dom.calls.filter(call => call.resource.endsWith('/events')).length, 1, 'no extra request');
  assert.equal(dom.get('first-error').hidden, false);
  assert.equal(dom.get('first-error-link').textContent, 'Data Flow Task › OLE DB Destination');
  assert.equal(dom.get('first-error-link').getAttribute('href'), '#events/errors');
  assert.match(dom.get('first-error-message').textContent, /^— Error 1: x+…$/);
  // A search narrows the page, so the line keeps the earlier qualifying error instead of the search result.
  dom.get('events-q').value = 'TAIL-2';
  dom.get('events-filters').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush(); await flush();
  assert.equal(dom.calls.at(-1).params.q, 'TAIL-2');
  assert.match(dom.get('first-error-message').textContent, /^— Error 1:/);
});

test('D2: a later qualifying page replaces the line, and executions without errors show none', async t => {
  let first = '1';
  const dom = mounted(t, { events: params => eventPage([errorRow(first)], params) });
  await flush(); await flush();
  first = '5';
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.match(dom.get('first-error-message').textContent, /^— Error 5:/);
  const quiet = mounted(t, { detail: failed(0), events: params => eventPage([], params) });
  await flush(); await flush();
  assert.equal(quiet.get('first-error').hidden, true);
});

test('D1: error rows show the whole returned message in a keyboard-scrollable region; others keep the preview', async t => {
  const dom = mounted(t, { hash: '#events', events: params => eventPage([errorRow('1'),
    eventRow('2', { message: 'w'.repeat(300) })], params) });
  await flush(); await flush();
  const [error, warning] = dom.eventBody.children;
  const errorPreview = error.children[2].children[0], warningPreview = warning.children[2].children[0];
  assert.match(errorPreview.textContent, /TAIL-1$/);
  assert.equal(errorPreview.dataset.full, 'true');
  assert.equal(errorPreview.getAttribute('tabindex'), '0');
  assert.equal(errorPreview.getAttribute('role'), 'region');
  assert.equal(error.children[2].children[2].hidden, true, 'no View message disclosure for whole text');
  assert.match(warningPreview.textContent, /…$/);
  assert.equal(warningPreview.dataset.full, 'false');
  assert.equal(warningPreview.getAttribute('tabindex'), null);
  assert.equal(error.children[1].children[1].textContent, 'Data Flow Task › OLE DB Destination');
  assert.equal(warning.children[1].children[1].hidden, true, 'empty source names are not shown');
});

test('D1: Copy writes the returned text when permitted, otherwise selects it for Ctrl+C', async t => {
  const selected = [];
  const plain = mounted(t, { hash: '#events', prepare: target => Object.assign(target.window, {
    getSelection: () => ({ selectAllChildren: node => selected.push(node) }), setTimeout: () => 1, clearTimeout: () => {} }) });
  await flush(); await flush();
  const fallback = plain.eventBody.firstChild.children[2].children[3];
  assert.equal(fallback.hidden, false, 'shown without the Clipboard API');
  fallback.dispatchEvent(new Event('click')); await flush();
  assert.equal(selected[0], plain.eventBody.firstChild.children[2].children[0], 'whole error text is selected');
  assert.equal(fallback.textContent, 'Selected · press Ctrl+C');
  const info = mounted(t, { hash: '#events', events: params => eventPage([eventRow('3', { event_name: 'OnInformation' })], params) });
  await flush(); await flush();
  assert.equal(info.eventBody.firstChild.children[2].children[3].hidden, true, 'no Copy on information rows');
  const written = [];
  const dom = mounted(t, { hash: '#events', prepare: target => Object.assign(target.window, { isSecureContext: true,
    navigator: { clipboard: { writeText: async value => { written.push(value); } } },
    setTimeout: () => 1, clearTimeout: () => {} }) });
  await flush(); await flush();
  const copy = dom.eventBody.firstChild.children[2].children[3];
  assert.equal(copy.hidden, false);
  copy.dispatchEvent(new Event('click')); await flush();
  assert.equal(written[0], errorRow('1').message);
  assert.equal(copy.textContent, 'Copied');
});

test('D7: a failed section read with nothing shown states the error and request ID in the table and wraps the status', async t => {
  const dom = mounted(t, { hash: '#events', events: () => { throw new ApiError('http', { status: 500, requestId: '0123456789abcdef0123456789abcdef' }); } });
  await flush(); await flush();
  assert.match(dom.eventBody.textContent, /Request ID: 0123456789abcdef0123456789abcdef/);
  assert.equal('error' in dom.get('events-status').dataset, true);
  assert.match(dom.get('events-status').textContent, /Request ID: 0123456789abcdef0123456789abcdef/);
});

// Codex review round 1 (2026-11-05) regressions.
test('R1-1: event denial removes the earliest-error text and link, not just hides them', async t => {
  let denied = false;
  const dom = mounted(t, { events: params => {
    if (denied) throw new ApiError('http', { status: 403 });
    return eventPage([errorRow('1')], params);
  } });
  await flush(); await flush();
  assert.equal(dom.get('first-error').hidden, false);
  denied = true;
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.get('first-error').hidden, true);
  assert.equal(dom.get('first-error-link').textContent, '');
  assert.equal(dom.get('first-error-message').textContent, '');
  assert.equal(dom.get('first-error-link').getAttribute('href'), null);
});

test('R1-2: a failed return to the first page keeps the earliest error from page one', async t => {
  let failFirst = false;
  const dom = mounted(t, { events: params => {
    if (!params.cursor && failFirst) throw new ApiError('http', { status: 503 });
    return eventPage([errorRow(params.cursor ? '7' : '1')], { ...params, has_more: !params.cursor,
      next_cursor: params.cursor ? null : 'event-next' });
  } });
  await flush(); await flush();
  dom.get('events-next').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.calls.at(-1).params.cursor, 'event-next');
  failFirst = true;
  dom.get('events-latest').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.match(dom.get('first-error-message').textContent, /^— Error 1:/);
});

test('R1-3/4/5: fallback selects visible text, feedback reaches a status region, and late completion sets no timer', async t => {
  const selected = [], timers = [];
  const dom = mounted(t, { hash: '#events', events: params => eventPage([eventRow('2', { message: 'short warning' })], params),
    prepare: target => Object.assign(target.window, { getSelection: () => ({ selectAllChildren: node => selected.push(node) }),
      setTimeout: () => timers.push(1), clearTimeout: () => {} }) });
  await flush(); await flush();
  const row = dom.eventBody.firstChild, copy = row.children[2].children[3];
  copy.dispatchEvent(new Event('click')); await flush();
  assert.equal(selected[0], row.children[2].children[0], 'the visible preview, not the hidden disclosure body');
  assert.equal(row.children[2].children[2].hidden, true);
  assert.equal(copy.getAttribute('aria-label'), null, 'the visible text names the button');
  assert.match(dom.get('events-copy-status').textContent, /Press Ctrl\+C/);
  const pending = []; let read = 0;
  const late = mounted(t, { hash: '#events', events: params => eventPage([errorRow(String(++read))], params), prepare: target => Object.assign(target.window, { isSecureContext: true,
    navigator: { clipboard: { writeText: () => new Promise(resolve => pending.push(resolve)) } },
    setTimeout: () => timers.push(2), clearTimeout: () => {} }) });
  await flush(); await flush();
  late.eventBody.firstChild.children[2].children[3].dispatchEvent(new Event('click'));
  const count = timers.length;
  late.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  pending[0](); await flush();
  assert.equal(timers.length, count, 'no feedback timer after the copied row was replaced');
});

test('R2 advisory: disposal clears a running feedback timer, and a clipboard result after disposal does nothing', async t => {
  const active = new Set(); let next = 0;
  const environment = target => Object.assign(target.window, { isSecureContext: true,
    setTimeout: () => { active.add(++next); return next; }, clearTimeout: id => { active.delete(id); },
    navigator: { clipboard: { writeText: () => new Promise(resolve => pending.push(resolve)) } } });
  const pending = [];
  const running = mounted(t, { hash: '#events', prepare: environment });
  await flush(); await flush();
  running.eventBody.firstChild.children[2].children[3].dispatchEvent(new Event('click'));
  pending.shift()(); await flush();
  assert.equal(active.size, 1, 'feedback timer running');
  running.dispose();
  assert.equal(active.size, 0, 'disposal cleared it');
  const late = mounted(t, { hash: '#events', prepare: environment });
  await flush(); await flush();
  const copy = late.eventBody.firstChild.children[2].children[3];
  copy.dispatchEvent(new Event('click'));
  late.dispose();
  pending.shift()(); await flush();
  assert.equal(active.size, 0, 'no timer after disposal');
  assert.equal(late.get('events-copy-status').textContent, '');
});
