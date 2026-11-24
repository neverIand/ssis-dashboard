import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';
import { historyMetadata, historyPage } from './history-fixture.js';

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
const partial = params => ({ ...params, has_unidentified_events: true, availability: 'unknown' });

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

test('R-04: errors without a public ID hide the earliest-error summary, also after a complete page', async t => {
  let coverage = 'partial';
  const dom = mounted(t, { events: params => eventPage([errorRow('9')], coverage === 'partial' ? partial(params) : params) });
  await flush(); await flush();
  assert.equal(dom.calls.filter(call => call.resource.endsWith('/events')).length, 1, 'no extra request');
  assert.equal(dom.get('first-error').hidden, true);
  assert.equal(dom.get('first-error-link').textContent, '');
  coverage = 'complete';
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.get('first-error').hidden, false);
  assert.match(dom.get('first-error-message').textContent, /^— Error 9:/);
  coverage = 'partial';
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.get('first-error').hidden, true);
  assert.equal(dom.get('first-error-link').textContent, '');
  assert.equal(dom.get('first-error-message').textContent, '');
  assert.equal(dom.get('first-error-link').getAttribute('href'), null);
  assert.match(dom.get('events-status').textContent, /no public numeric ID/);
});

test('R-04: from page two, the header link returns to page one with one cursorless request', async t => {
  const dom = mounted(t, { events: params => eventPage([errorRow(params.cursor ? '7' : '1')], { ...params,
    has_more: !params.cursor, next_cursor: params.cursor ? null : 'event-next' }) });
  await flush(); await flush();
  dom.get('events-next').dispatchEvent(new Event('click')); await flush(); await flush();
  assert.equal(dom.calls.at(-1).params.cursor, 'event-next');
  const before = dom.calls.length;
  dom.get('first-error-link').dispatchEvent(new Event('click', { cancelable: true })); await flush(); await flush();
  assert.deepEqual(dom.calls.slice(before).map(call => [call.resource, call.params.cursor ?? null]),
    [['executions/17/events', null]]);
  assert.match(dom.get('first-error-message').textContent, /^— Error 1:/);
});

test('R-03: an inactive 50-row Warnings page and the full error message can be collected; the excerpt stays', () => {
  // A separate process started with --expose-gc, so no V8 flag changes after startup in this test process.
  const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./header-retention-gc.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

const click = node => node.dispatchEvent(new Event('click'));
function screen(t, { tab = 'history', read = () => historyPage(), response = () => detailResponse('17') } = {}) {
  const dom = detailDOM(), calls = [], metadata = historyMetadata();
  metadata.capabilities.events = true;
  metadata.event_kinds = ['all', 'errors', 'warnings'];
  dom.window.location.hash = `#${tab}`;
  const view = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/app/', api: {
    async get(resource, options) {
      calls.push({ resource, ...options });
      return resource === 'history' || resource.endsWith('/events') ? read(resource, options) : response();
    },
  } });
  t.after(view.dispose);
  return { ...dom, calls, view };
}

test('event count wording follows zero, one and many while preserving links, levels and focus', async t => {
  let count = 0;
  const dom = screen(t, { response: () => {
    const result = detailResponse('17');
    Object.assign(result.data, { warning_count: count, error_count: count });
    Object.assign(result.data.event_counts, { all: count * 2, errors: count, warnings: count,
      duplicate_warnings: 0, memory_warnings: 0 });
    return result;
  } });
  await flush();
  const link = dom.field('errors'); link.focus();
  for (count = 0; count <= 2; count++) {
    if (count) { click(dom.get('detail-refresh')); await flush(); }
    for (const key of ['errors', 'warnings']) {
      const label = count === 1 ? key.slice(0, -1) : key;
      assert.equal(dom.root.querySelector(`[data-event-count-label="${key}"]`).textContent, label);
      assert.equal(dom.field(key).textContent, String(count));
      assert.equal(dom.field(key).getAttribute('aria-label'), `${count} ${label} for this execution`);
      assert.equal(dom.field(key).href, `#events/${key}`);
      assert.equal(dom.field(key).dataset.level, count === 0 ? 'quiet' : key === 'errors' ? 'error' : 'warning');
    }
    assert.equal(dom.field('all').getAttribute('aria-label'), `${count * 2} events for this execution`);
    assert.equal(dom.field('errors'), link); assert.equal(dom.document.activeElement, link);
    assert.equal(dom.calls.length, (count + 1) * 2);
  }
});
