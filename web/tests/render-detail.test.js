import assert from 'node:assert/strict';
import test from 'node:test';
import { mountBootstrap } from '../src/bootstrap.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, envelope, jsonResponse, requestId } from './fixtures.js';
import { ApiError } from '../src/api.js';
import { metadata } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('detail bootstrap needs no overview controls and requests metadata then only one detail', async t => {
  const dom = detailDOM(), settings = deferred(), calls = [];
  const response = detailResponse();
  response.data.package_name = '<img src=x onerror=alert(1)> 影狼\n+ /';
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url.pathname + url.search);
    return url.pathname.endsWith('/meta') ? settings.promise : jsonResponse(response);
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  assert.deepEqual(calls, ['/ops/api/v1/meta']);
  settings.resolve(jsonResponse(envelope()));
  await settle();
  assert.deepEqual(calls, ['/ops/api/v1/meta', '/ops/api/v1/executions/9223372036854775807']);
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.equal(dom.field('package').textContent, response.data.package_name);
  assert.equal(dom.field('created').attributes.get('datetime'), response.data.created_at);
  assert.equal(dom.field('status').dataset.status, '7');
  assert.equal(dom.field('errors').textContent, '0');
  assert.equal(dom.get('active-elapsed').hidden, true);
  assert.match(dom.get('detail-observed').textContent, /^Observed /);
  dispose();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.equal(dom.field('package').textContent, '—');
});

test('settings failure leaves detail unfetched; keyboard retry loads it after successful settings', async t => {
  const dom = detailDOM(), calls = [];
  let failed = false;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname);
    if (!failed) {
      failed = true;
      return jsonResponse({ detail: '<script>private</script>' }, { status: 503 });
    }
    return jsonResponse(url.pathname.endsWith('/meta') ? envelope() : detailResponse());
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  await settle();
  assert.deepEqual(calls, ['/ops/api/v1/meta']);
  assert.equal(dom.get('retry').hidden, false);
  assert.equal(dom.get('app-status').textContent, 'The service is unavailable. Try again.');
  dom.get('retry').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(dom.get('execution-detail').hidden, false);
  dispose();
});

test('safe detail failure and retry expose only validated correlation; active timing is labeled separately', async t => {
  const dom = detailDOM();
  let attempts = 0;
  const response = detailResponse();
  Object.assign(response.data, { ended_at: null, duration_seconds: null, elapsed_seconds: 12.3,
    status: { code: -1, name: 'unknown' } });
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope());
    if (++attempts === 1) return jsonResponse({ detail: '<script>private error</script>' }, { status: 404 });
    return jsonResponse(response);
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  await settle();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.equal(dom.get('detail-status').textContent, 'The requested resource is unavailable.');
  assert.equal(dom.get('detail-request-id').textContent, `Request ID: ${requestId}`);
  assert.equal(dom.get('detail-retry').hidden, false);
  dom.get('detail-retry').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(attempts, 2);
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.equal(dom.get('active-elapsed').hidden, false);
  assert.equal(dom.field('duration').textContent, '—');
  assert.equal(dom.field('status').dataset.status, 'unknown');
  assert.equal(dom.get('detail-request-id').textContent, '');
  dispose();
  dom.get('detail-retry').dispatchEvent(new Event('click'));
  assert.equal(attempts, 2);
});

test('refresh keeps field identity and current focus/scroll when the user moves during a slow request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM(), pending = deferred();
  let attempts = 0;
  const changed = detailResponse();
  changed.data.event_counts.errors = changed.data.error_count = 1;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: changed.data.execution_id, appBase: '/ops/app/',
    api: { get: () => ++attempts === 2 ? pending.promise : Promise.resolve(detailResponse()) } });
  t.after(screen.dispose);
  await settle();
  const field = dom.field('errors');
  dom.get('detail-refresh').focus();
  dom.window.scrollTo(0, 300);
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  assert.equal(dom.document.activeElement, dom.get('detail-refresh'));
  assert.equal(dom.get('detail-refresh').attributes.get('aria-disabled'), 'true');
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  dom.get('overview-link').focus();
  dom.window.scrollTo(0, 700);
  pending.resolve(changed);
  await settle();
  assert.equal(attempts, 2);
  assert.equal(dom.field('errors'), field);
  assert.equal(field.textContent, '1');
  assert.equal(dom.document.activeElement, dom.get('overview-link'));
  assert.equal(dom.window.scrollY, 700);
});

test('transient refresh is labeled with its old observation time; denial clears data and stops the timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM();
  let failure = null, attempts = 0;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
    appBase: '/ops/app/', api: { async get() { attempts++; if (failure) throw failure; return detailResponse(); } } });
  t.after(screen.dispose);
  await settle();
  const observed = dom.get('detail-observed').textContent;
  failure = new ApiError('http', { status: 503, requestId });
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.match(dom.get('detail-status').textContent, /Previous observation shown/);
  assert.equal(dom.get('detail-observed').textContent, observed);
  failure = new ApiError('http', { status: 403, requestId });
  dom.get('detail-retry').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.equal(dom.field('package').textContent, '—');
  assert.equal(dom.field('status').textContent, '—');
  assert.equal(dom.field('status').dataset.status, undefined);
  assert.doesNotMatch(dom.root.textContent, /Main\.dtsx|succeeded/);
  assert.equal(dom.get('detail-observed').textContent, '');
  assert.match(dom.get('detail-poll-status').textContent, /stopped/);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(attempts, 3);
});

test('a retained detail checkpoint carries only pause/view state and re-fetches before restoring', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM();
  const options = { metadata: metadata(), executionId: detailResponse().data.execution_id, appBase: '/ops/app/' };
  const first = mountDetail(dom.root, { ...options, api: { get: async () => detailResponse() } });
  await settle();
  dom.get('detail-poll-toggle').dispatchEvent(new Event('click'));
  dom.get('detail-refresh').focus();
  dom.window.scrollTo(0, 450);
  const checkpoint = first.checkpoint();
  assert.deepEqual(Object.keys(checkpoint).sort(), ['autoPaused','childView','children','eventView','events','executableView','executables','executionId','focus','history','historyView','overrideView','overrides','parameterView','parameters','position']);
  assert.equal(checkpoint.autoPaused, true);
  assert.doesNotMatch(JSON.stringify(checkpoint), /package|cursor|event_counts|Main/);
  first.dispose();
  dom.document.activeElement = dom.document.body;
  dom.window.scrollTo(0, 0);
  let calls = 0;
  const second = mountDetail(dom.root, { ...options, restoreView: checkpoint,
    api: { async get() { calls++; return detailResponse(); } } });
  await settle();
  assert.equal(calls, 1);
  assert.equal(dom.window.scrollY, 450);
  assert.equal(dom.document.activeElement, dom.get('detail-refresh'));
  assert.equal(dom.get('detail-poll-toggle').textContent, 'Resume auto refresh');
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls, 1);
  second.dispose();
  dom.document.dispatchEvent(new Event('visibilitychange'));
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  dom.get('detail-poll-toggle').dispatchEvent(new Event('click'));
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
});

test('detail return filters are validated after metadata and never sent to its API read', async () => {
  const dom = detailDOM(), calls = [];
  dom.window.location.search = '?overview=%3Ffolder%3DFold%252B%2B%252F%26limit%3D5';
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
    appBase: '/ops/app/', api: { async get(resource, options) { calls.push({ resource, options }); return detailResponse(); } } });
  await settle();
  assert.equal(dom.get('overview-link').href, '/ops/app/?folder=Fold%2B+%2F&limit=5');
  assert.match(dom.get('overview-return-notice').textContent, /page one/);
  assert.deepEqual(Object.keys(calls[0].options), ['signal']);
  screen.dispose();
  assert.equal(dom.get('detail-retry').hidden, true);
  assert.equal(dom.get('detail-poll-status').textContent, '');
});

test('late retained restoration respects focus and scroll moved during revalidation', async t => {
  const dom = detailDOM(), pending = deferred();
  const id = detailResponse().data.execution_id;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: id, appBase: '/ops/app/',
    restoreView: { executionId: id, autoPaused: true, focus: 'refresh', position: { x: 0, y: 500 } },
    api: { get: () => pending.promise } });
  t.after(screen.dispose);
  dom.get('overview-link').focus();
  dom.window.scrollTo(0, 250);
  pending.resolve(detailResponse());
  await settle();
  assert.equal(dom.document.activeElement, dom.get('overview-link'));
  assert.equal(dom.window.scrollY, 250);
});
