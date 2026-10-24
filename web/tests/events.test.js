import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { eventQuery, readEventPage } from '../src/events.js';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { deferred, wireTime } from './fixtures.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventRow, eventPage } from './event-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const metadata = eventMetadata(), display = createDisplay({ timeZone: metadata.display_timezone });
const query = { sort: 'message_time', direction: 'asc', limit: 50, kind: 'all', q: null };
function setup(t, get, options = {}) {
  const calls = [], states = [];
  const owner = createDetailLoader({ api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } },
    metadata: eventMetadata(), executionId: '17', autoRefresh: false, publish: state => states.push(state), ...options });
  t.after(() => owner.dispose());
  return { owner, calls, get state() { return states.at(-1); } };
}
const response = (resource, params = {}) => resource.endsWith('/events') ? eventPage(undefined, params)
  : resource.endsWith('/executables') ? executablePage() : resource.endsWith('/children') ? childPage() : detailResponse(resource.split('/')[1]);

test('event selection preserves literal queries, code points and exact whitespace without wildcard processing', () => {
  const q = ' %_+[影狼] \r\n ';
  assert.equal(eventQuery({ ...query, q }, metadata).q, q);
  assert.equal(eventQuery({ ...query, q: '😀'.repeat(512) }, metadata).q.length, 1024);
  assert.equal(eventQuery({ ...query, q: '' }, metadata).q, null);
  for (const changes of [{ q: 'x'.repeat(513) }, { q: '😀'.repeat(513) }, { q: 'x\0y' }, { q: '\ud800' },
    { q: 1 }, { kind: 'unknown' }, { sort: 'started_at' }, { direction: 'sideways' }, { limit: 201 }]) {
    assert.throws(() => eventQuery({ ...query, ...changes }, metadata));
  }
});

test('event DTO preserves precise IDs/time, literal NULL/empty text, unknown codes, truncation and coverage', () => {
  const page = eventPage([eventRow('9007199254740993', { message: null, source_name: null, event_name: null }),
    eventRow('9223372036854775807', { message: '😀'.repeat(16384), truncated: true, message_type: -32768, source_type: 32767 })],
  { has_unidentified_events: true, availability: 'unknown' });
  assert.equal(readEventPage(page, '17', query, metadata, display), page);
  assert.equal(page.data[1].message_time, wireTime);
  assert.equal(readEventPage(eventPage([eventRow('1', { message: '' })]), '17', query, metadata, display).data[0].message, '');
  for (const mutate of [p => { p.data[0].event_id = null; }, p => { p.data[0].execution_id = '18'; },
    p => { p.data[0].event_id = p.data[1].event_id; }, p => { p.meta.upper_id = '1'; },
    p => { p.data[0].message_time = null; }, p => { p.data[0].message_type = null; }, p => { p.data[0].source_type = 32768; },
    p => { p.data[0].event_name = '😀'.repeat(513); }, p => { p.data[0].package_name = ''; },
    p => { p.data[0].execution_path = 'x'.repeat(16385); }, p => { p.data[1].truncated = 1; },
    p => { p.data[1].message = 'too short'; }, p => { p.meta.availability = 'available'; },
    p => { p.meta.has_unidentified_events = null; }, p => { p.meta.limit = 200; }]) {
    const bad = structuredClone(page); mutate(bad);
    assert.throws(() => readEventPage(bad, '17', query, metadata, display), error => error.kind === 'invalid_response');
  }
});

test('disabled events never request data, including restored or programmatic opening, filtering and refresh', async t => {
  const run = setup(t, async resource => detailResponse(resource.split('/')[1]), { metadata: eventMetadata(false),
    restoreEvents: { open: true, query, path: { entries: [null], index: 0 } } });
  await run.owner.load(); await run.owner.toggleEvents(); await run.owner.applyEvents({ kind: 'errors' });
  await run.owner.refresh(); assert.equal(run.calls.length, 2); assert.equal(run.state.events.open, false);
  assert.equal(run.state.events.page, null);
});

test('events load lazily and keep their independent query, page path and fence during three-section refresh', async t => {
  const run = setup(t, async (resource, { params }) => resource.endsWith('/events')
    ? eventPage([eventRow(params.cursor ? '2' : '1')], { ...params, has_more: !params.cursor, next_cursor: params.cursor ? null : 'event-next' }) : response(resource));
  await run.owner.load(); assert.equal(run.calls.length, 1);
  await run.owner.toggleExecutables(); await run.owner.toggleChildren(); await run.owner.toggleEvents();
  await run.owner.nextEvents(); assert.equal(run.state.events.pageNumber, 2);
  await run.owner.refresh(); assert.deepEqual(run.calls.slice(-4).map(call => call.resource),
    ['executions/17', 'executions/17/executables', 'executions/17/children', 'executions/17/events']);
  assert.equal(run.calls.at(-1).params.cursor, 'event-next');
  await run.owner.applyEvents({ kind: 'warnings', q: '  %_ +  ' });
  assert.equal(run.state.events.pageNumber, 1); assert.equal(run.calls.at(-1).params.q, '  %_ +  ');
  assert.equal(run.calls.at(-1).params.cursor, undefined); assert.equal(run.state.executables.pageNumber, 1);
  await run.owner.toggleEvents(); await run.owner.refresh(); assert.equal(run.calls.at(-1).resource, 'executions/17/children');
});

test('applying a new search aborts obsolete event work and rejects late denial and stale old-query data', async t => {
  const pending = deferred(); let count = 0;
  const run = setup(t, resource => !resource.endsWith('/events') ? Promise.resolve(response(resource))
    : ++count === 1 ? pending.promise : Promise.resolve(eventPage([eventRow('2', { message: 'new search' })])));
  await run.owner.load(); const old = run.owner.toggleEvents(); const signal = run.calls.at(-1).signal;
  await run.owner.applyEvents({ q: 'new search', kind: 'errors' });
  assert.equal(signal.aborted, true); const page = run.state.events.page;
  pending.reject(new ApiError('http', { status: 404 })); await old;
  assert.equal(run.state.events.page, page); assert.notEqual(run.state.response, null);
  assert.equal(run.state.events.query.q, 'new search');
});

test('a same-query Apply queues behind unrelated section work; multiple drafts coalesce to the last query', async t => {
  let slow = false; const pending = deferred();
  const run = setup(t, resource => resource.endsWith('/executables') && slow ? pending.promise : Promise.resolve(response(resource)));
  await run.owner.load(); await run.owner.toggleEvents(); slow = true;
  const other = run.owner.toggleExecutables(); await run.owner.applyEvents({ q: null });
  await run.owner.applyEvents({ q: 'first' }); await run.owner.applyEvents({ q: 'last' });
  const count = run.calls.length; pending.resolve(executablePage()); await other;
  assert.equal(run.calls.length, count + 1); assert.equal(run.calls.at(-1).params.q, 'last');
  assert.equal(run.state.events.phase, 'ready');
});

test('search supersession preserves another queued section and a failed new selection never retains the old rows', async t => {
  const pending = deferred(); let slow = false, fail = false;
  const run = setup(t, resource => resource.endsWith('/events') && fail ? Promise.reject(new ApiError('http', { status: 503 }))
    : resource.endsWith('/events') && slow ? pending.promise : Promise.resolve(response(resource)));
  await run.owner.load(); await run.owner.toggleEvents(); slow = true;
  const old = run.owner.retryEvents(); await run.owner.toggleChildren(); slow = false;
  await run.owner.applyEvents({ q: 'current' }); assert.equal(run.state.children.phase, 'ready');
  pending.resolve(eventPage([eventRow('2')])); await old;
  fail = true; await run.owner.applyEvents({ q: 'unavailable' });
  assert.equal(run.state.events.page, null); assert.equal(run.state.events.stale, false);
  assert.equal(run.state.children.page.data.length, 1);
});

test('event errors remain scoped, expiry resets once, and a section 404 clears all protected observations', async t => {
  let failure = null;
  const run = setup(t, async (resource, { params }) => {
    if (!resource.endsWith('/events')) return response(resource);
    if (failure) throw failure;
    return eventPage([eventRow(params.cursor ? '2' : '1')], { ...params, has_more: !params.cursor, next_cursor: params.cursor ? null : 'event-next' });
  });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleEvents(); await run.owner.nextEvents();
  const previous = run.state.events.page;
  failure = new ApiError('http', { status: 503 }); await run.owner.retryEvents(); assert.equal(run.state.events.page, previous);
  failure = new ApiError('http', { status: 400, code: 'cursor_expired' }); const count = run.calls.length;
  await run.owner.retryEvents(); assert.equal(run.calls.length, count + 2); assert.equal(run.state.events.page, null);
  assert.match(run.state.events.notice, /Reset to page one/);
  failure = new ApiError('http', { status: 403 }); await run.owner.retryEvents(); assert.notEqual(run.state.executables.page, null);
  failure = new ApiError('http', { status: 404 }); await run.owner.retryEvents();
  assert.equal(run.state.response, null); assert.equal(run.state.executables.page, null);
});

test('one completion-based scheduler waits for event work and coalesces manual and visibility recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = deferred(); let count = 0;
  const run = setup(t, resource => resource.endsWith('/events') && ++count === 2 ? pending.promise : Promise.resolve(response(resource)),
    { autoRefresh: true, pollIntervalMs: 1000 });
  await run.owner.load(); await run.owner.toggleEvents(); t.mock.timers.tick(1000); await flush();
  const requests = run.calls.length; run.owner.refresh(); run.owner.nextEvents(); run.owner.setVisible(false); run.owner.setVisible(true);
  t.mock.timers.tick(1000); await flush(); assert.equal(run.calls.length, requests);
  pending.resolve(eventPage()); await flush(); t.mock.timers.tick(0); await flush(); assert.equal(run.calls.length, requests + 2);
});

test('event generations and deadlines guard query switches, A to B to A, close and disposal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let slow = false;
  const run = setup(t, (resource, { signal }) => slow && resource.endsWith('/events')
    ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new ApiError('network'))))
    : Promise.resolve(resource.endsWith('/events') ? eventPage([eventRow('1', { execution_id: resource.split('/')[1] })]) : response(resource)), { timeoutMs: 20 });
  await run.owner.load(); await run.owner.toggleEvents(); slow = true; const old = run.owner.retryEvents();
  t.mock.timers.tick(20); await old; assert.equal(run.state.events.error.kind, 'timeout');
  slow = false; await run.owner.select('18'); await run.owner.select('17'); assert.equal(run.state.events.page.data[0].execution_id, '17');
  slow = true; const closing = run.owner.retryEvents(); const signal = run.calls.at(-1).signal;
  await run.owner.toggleEvents(); assert.equal(signal.aborted, true); await closing; assert.equal(run.state.events.page, null);
  const opening = run.owner.toggleEvents(); const last = run.calls.at(-1).signal; run.owner.dispose(); await opening;
  assert.equal(last.aborted, true);
});

function mounted(t, get, options = {}) {
  const dom = detailDOM(), calls = [];
  const screen = mountDetail(dom.root, { executionId: '17', appBase: '/app/', metadata: eventMetadata(), ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(() => screen.dispose());
  const action = key => dom.get(`events-${key}`).dispatchEvent(new Event(key === 'filters' ? 'submit' : 'click'));
  return { dom, screen, calls, action };
}

test('event UI separates draft filters from applied search, preserves invalid input and resets filters only', async t => {
  const run = mounted(t, async (resource, { params }) => response(resource, params)); await flush(); run.action('toggle'); await flush();
  const { dom } = run; dom.get('events-kind').value = 'warnings'; dom.get('events-q').value = ' %_\r\n ';
  assert.equal(dom.get('events-scope').textContent, ''); const count = run.calls.length;
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  assert.equal(run.calls.at(-1).params.q, null); assert.equal(dom.get('events-q').value, ' %_\r\n ');
  run.action('filters'); await flush(); assert.equal(run.calls.at(-1).params.q, ' %_\r\n '); assert.equal(run.calls.at(-1).params.kind, 'warnings');
  assert.equal(dom.get('events-scope').textContent, 'Warnings · Search: " %_\\r\\n "');
  dom.get('events-q').value = 'x'.repeat(513); const current = run.calls.length; run.action('filters'); await flush();
  assert.equal(run.calls.length, current); assert.match(dom.get('events-notice').textContent, /512/);
  run.action('reset'); await flush(); assert.equal(run.calls.at(-1).params.q, null); assert.equal(run.calls.at(-1).params.kind, 'all');
  assert.equal(dom.get('events-q').value, ''); assert.ok(run.calls.length > count);
});

test('keyed event rows keep literal text, expanded source/message and current focus/scroll across refresh', async t => {
  const pending = deferred(); let count = 0;
  const run = mounted(t, resource => resource.endsWith('/events') ? ++count === 1
    ? Promise.resolve(eventPage([eventRow('1', { message: '😀'.repeat(16384), truncated: true }), eventRow('2', { message: '' })],
      { has_unidentified_events: true, availability: 'unknown' })) : pending.promise : Promise.resolve(response(resource)));
  await flush(); run.action('toggle'); await flush();
  const row = run.dom.eventBody.firstChild, message = row.children[3].children[2], source = row.children[4].firstChild;
  assert.match(row.textContent, /Truncated to 16384/); assert.match(run.dom.get('events-status').textContent, /no public numeric ID/);
  assert.match(run.dom.eventBody.children[1].textContent, /\(empty\)/);
  message.open = source.open = true; source.firstChild.focus();
  run.dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  run.dom.get('legacy-detail-link').focus(); run.dom.get('events-scroll').scrollLeft = 140;
  pending.resolve(eventPage([eventRow('1', { message: '<b>updated</b>' })])); await flush();
  assert.equal(run.dom.eventBody.firstChild, row); assert.equal(source.open, true);
  assert.equal(run.dom.document.activeElement, run.dom.get('legacy-detail-link')); assert.equal(run.dom.get('events-scroll').scrollLeft, 140);
  assert.match(row.textContent, /<b>updated<\/b>/); assert.equal(row.children[1].firstChild.getAttribute('datetime'), wireTime);
});

test('retained event state holds only user query/view anchors and revalidates; disabled metadata drops it', async t => {
  const run = mounted(t, async (resource, { params }) => response(resource, params)); await flush(); run.action('toggle'); await flush();
  run.dom.get('events-q').value = 'unapplied draft'; const saved = run.screen.checkpoint();
  assert.doesNotMatch(JSON.stringify(saved), /literal|source_name|Probe.dtsx/);
  // message_time is the public sort token, not a retained observation timestamp.
  assert.equal(saved.eventView.draft.q, 'unapplied draft'); run.screen.dispose();
  const next = mounted(t, async (resource, { params }) => response(resource, params), { restoreView: saved }); await flush();
  assert.equal(next.dom.get('events-q').value, 'unapplied draft'); assert.equal(next.calls.at(-1).resource, 'executions/17/events');
  const off = mounted(t, async resource => response(resource), { restoreView: saved, metadata: eventMetadata(false) }); await flush();
  assert.equal(off.calls.length, 1); assert.equal(off.dom.get('events-toggle').disabled, true); assert.equal(off.dom.eventBody.children.length, 1);
  assert.equal(off.dom.get('events-q').value, '');
});

test('event denial clears row text with a connected focus fallback; 404 also clears the visible entry heading', async t => {
  let failure = null;
  const run = mounted(t, async resource => {
    if (!resource.endsWith('/events')) return response(resource);
    if (failure) throw failure;
    return eventPage();
  });
  await flush(); run.action('toggle'); await flush();
  run.dom.eventBody.firstChild.children[4].firstChild.firstChild.focus();
  failure = new ApiError('http', { status: 403 }); run.dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  assert.doesNotMatch(run.dom.eventBody.textContent, /literal|影狼/);
  assert.equal(run.dom.document.activeElement, run.dom.get('events-scroll')); assert.equal(run.dom.field('package').textContent, 'Main.dtsx');
  failure = new ApiError('http', { status: 404 }); run.action('retry'); await flush();
  assert.equal(run.dom.field('package').textContent, '—'); assert.equal(run.dom.field('status').textContent, '—');
});

test('retained message/source expansion restores after a fresh read and missing message focus uses the table', async t => {
  let long = true;
  const get = async resource => resource.endsWith('/events') ? eventPage([eventRow('1', { message: long ? 'x'.repeat(200) : 'short' })]) : response(resource);
  const first = mounted(t, get); await flush(); first.action('toggle'); await flush();
  const row = first.dom.eventBody.firstChild, message = row.children[3].children[2], source = row.children[4].firstChild;
  message.open = source.open = true; message.firstChild.focus();
  const saved = first.screen.checkpoint(); first.screen.dispose();
  const next = mounted(t, get, { restoreView: saved }); await flush();
  assert.equal(next.dom.eventBody.firstChild.children[3].children[2].open, true);
  assert.equal(next.dom.eventBody.firstChild.children[4].firstChild.open, true);
  long = false;
  const short = mounted(t, get, { restoreView: saved }); await flush();
  assert.equal(short.dom.document.activeElement, short.dom.get('events-scroll'));
});
