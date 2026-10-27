import assert from 'node:assert/strict';
import test from 'node:test';
import { mountBootstrap } from '../src/bootstrap.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, envelope, jsonResponse, requestId } from './fixtures.js';
import { ApiError } from '../src/api.js';
import { metadata } from './fixtures.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executable, executablePage } from './executable-fixture.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const observations = (id = detailResponse().data.execution_id) => executablePage([executable('1', { execution_id: id })]);

test('detail bootstrap needs no overview controls and requests metadata, detail and its default tab', async t => {
  const dom = detailDOM(), settings = deferred(), calls = [];
  const response = detailResponse();
  response.data.package_name = '<img src=x onerror=alert(1)> 影狼\n+ /';
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url.pathname + url.search);
    return url.pathname.endsWith('/meta') ? settings.promise : jsonResponse(url.pathname.endsWith('/executables') ? observations() : response);
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  t.after(dispose);
  assert.deepEqual(calls, ['/ops/api/v1/meta']);
  settings.resolve(jsonResponse(envelope()));
  await settle();
  assert.deepEqual(calls, ['/ops/api/v1/meta', '/ops/api/v1/server', '/ops/api/v1/executions/9223372036854775807',
    '/ops/api/v1/executions/9223372036854775807/executables?sort=started_at&direction=asc&limit=50']);
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.equal(dom.field('package').textContent, response.data.package_name);
  assert.equal(dom.field('created').attributes.get('datetime'), response.data.created_at);
  assert.equal(dom.field('status').dataset.status, '7');
  assert.equal(dom.field('errors').textContent, '0');
  assert.equal(dom.get('active-elapsed').hidden, true);
  assert.equal(dom.field('created').textContent, '2026-10-17 17:00:00');
  assert.equal(dom.field('created').getAttribute('title'), response.data.created_at);
  assert.equal(dom.get('detail-poll-status').textContent, 'Updated 17:00:00 · Execution ended · auto refresh off');
  assert.ok(dom.get('detail-poll-status').title.includes(detailResponse('17').meta.generated_at));
  dispose();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.equal(dom.field('package').textContent, 'Execution 9223372036854775807');
  assert.equal(dom.field('status').hidden, true);
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
    return jsonResponse(url.pathname.endsWith('/meta') ? envelope() : url.pathname.endsWith('/executables') ? observations() : detailResponse());
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  t.after(dispose);
  await settle();
  assert.deepEqual(calls, ['/ops/api/v1/meta']);
  assert.equal(dom.get('retry').hidden, false);
  assert.equal(dom.get('app-status').textContent, 'The service is unavailable. Try again.');
  dom.get('retry').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(calls.length, 5);
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
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Synthetic server' }));
    if (url.pathname.endsWith('/executables')) return jsonResponse(observations());
    if (++attempts === 1) return jsonResponse({ detail: '<script>private error</script>' }, { status: 404 });
    return jsonResponse(response);
  });
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id, appBase: config.app_base }).dispose });
  t.after(dispose);
  await settle();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.match(dom.get('detail-status').textContent, /Execution unavailable.*The requested resource is unavailable/);
  assert.ok(dom.get('detail-status').title.includes(`Request ID: ${requestId}`));
  assert.equal(dom.get('detail-refresh').hidden, false);
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(attempts, 2);
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.equal(dom.get('active-elapsed').hidden, false);
  assert.equal(dom.field('duration').textContent, '—');
  assert.equal(dom.field('status').dataset.status, 'unknown');
  assert.ok(!dom.get('detail-status').title.includes(requestId));
  dispose();
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  assert.equal(attempts, 2);
});

test('refresh keeps field identity and current focus/scroll when the user moves during a slow request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM(), pending = deferred();
  let attempts = 0;
  const changed = detailResponse();
  changed.data.event_counts.errors = changed.data.error_count = 1;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: changed.data.execution_id, appBase: '/ops/app/',
    api: { get: resource => resource.endsWith('/executables') ? Promise.resolve(observations())
      : ++attempts === 2 ? pending.promise : Promise.resolve(detailResponse()) } });
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
    appBase: '/ops/app/', api: { async get(resource) { if (resource.endsWith('/executables')) return observations();
      attempts++; if (failure) throw failure; return detailResponse(); } } });
  t.after(screen.dispose);
  await settle();
  failure = new ApiError('http', { status: 503, requestId });
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(dom.get('execution-detail').hidden, false);
  assert.match(dom.get('detail-status').textContent, /Refresh failed.*showing data from/);
  assert.ok(dom.get('detail-poll-status').title.includes(detailResponse('17').meta.generated_at));
  assert.ok(dom.get('detail-poll-status').title.includes(requestId));
  failure = new ApiError('http', { status: 403, requestId });
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.equal(dom.get('execution-detail').hidden, true);
  assert.equal(dom.field('package').textContent, 'Execution 9223372036854775807');
  assert.equal(dom.field('status').textContent, ''); assert.equal(dom.field('status').hidden, true);
  assert.equal(dom.field('status').dataset.status, undefined);
  assert.doesNotMatch(dom.root.textContent, /Main\.dtsx|succeeded/);
  assert.ok(!dom.get('detail-poll-status').title.includes('Observed'));
  assert.match(dom.get('detail-poll-status').textContent, /Execution unavailable/);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(attempts, 3);
});

test('a retained detail checkpoint carries only pause/view state and re-fetches before restoring', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM();
  const options = { metadata: metadata(), executionId: detailResponse().data.execution_id, appBase: '/ops/app/' };
  const first = mountDetail(dom.root, { ...options, api: { get: async resource => resource.endsWith('/executables') ? observations() : runningDetailResponse() } });
  await settle();
  dom.get('detail-poll-toggle').dispatchEvent(new Event('click'));
  dom.get('detail-refresh').focus();
  dom.window.scrollTo(0, 450);
  const checkpoint = first.checkpoint();
  assert.deepEqual(Object.keys(checkpoint).sort(), ['activeTab','autoPaused','childView','children','eventView','events','executableView','executables','executionId','focus','history','historyView','overrideView','overrides','parameterView','parameters','position']);
  assert.equal(checkpoint.autoPaused, true);
  assert.doesNotMatch(JSON.stringify(checkpoint), /package|cursor|event_counts|Main/);
  first.dispose();
  dom.document.activeElement = dom.document.body;
  dom.window.scrollTo(0, 0);
  let calls = 0;
  const second = mountDetail(dom.root, { ...options, restoreView: checkpoint,
    api: { async get(resource) { calls++; return resource.endsWith('/executables') ? observations() : runningDetailResponse(); } } });
  await settle();
  assert.equal(calls, 2);
  assert.equal(dom.window.scrollY, 450);
  assert.equal(dom.document.activeElement, dom.get('detail-refresh'));
  assert.equal(dom.get('detail-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls, 2);
  second.dispose();
  dom.document.dispatchEvent(new Event('visibilitychange'));
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  dom.get('detail-poll-toggle').dispatchEvent(new Event('click'));
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
});

test('detail return filters are validated after metadata and never sent to its API read', async () => {
  const dom = detailDOM(), calls = [];
  dom.window.location.search = '?overview=%3Ffolder%3DFold%252B%2B%252F%26limit%3D5';
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
    appBase: '/ops/app/', api: { async get(resource, options) { calls.push({ resource, options });
      return resource.endsWith('/executables') ? observations() : detailResponse(); } } });
  await settle();
  assert.equal(dom.get('overview-link').href, '/ops/app/?folder=Fold%2B+%2F&limit=5');
  assert.equal(dom.get('overview-return-notice').hidden, true);
  assert.match(dom.get('overview-link').title, /page one/);
  assert.deepEqual(Object.keys(calls[0].options), ['signal']);
  screen.dispose();
  assert.equal(dom.get('detail-refresh').disabled, true);
  assert.equal(dom.get('detail-poll-status').textContent, '');
});

test('late retained restoration respects focus and scroll moved during revalidation', async t => {
  const dom = detailDOM(), pending = deferred();
  const id = detailResponse().data.execution_id;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: id, appBase: '/ops/app/',
    restoreView: { executionId: id, autoPaused: true, focus: 'refresh', position: { x: 0, y: 500 } },
    api: { get: resource => resource.endsWith('/executables') ? Promise.resolve(observations()) : pending.promise } });
  t.after(screen.dispose);
  dom.get('overview-link').focus();
  dom.window.scrollTo(0, 250);
  pending.resolve(detailResponse());
  await settle();
  assert.equal(dom.document.activeElement, dom.get('overview-link'));
  assert.equal(dom.window.scrollY, 250);
});

test('ended detail disables Pause with an explanation, ignores visible return and preserves manual two-read Refresh', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM(), calls = [];
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
    appBase: '/ops/app/', api: { async get(resource) {
      calls.push(resource); return resource.endsWith('/executables') ? observations() : detailResponse();
    } } });
  t.after(screen.dispose);
  await settle();
  const toggle = dom.get('detail-poll-toggle');
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.getAttribute('aria-label'), 'Automatic refresh is off for an ended execution');
  assert.equal(toggle.title, toggle.getAttribute('aria-label'));
  assert.equal(dom.get('detail-refresh').disabled, false);
  assert.equal(dom.get('detail-poll-status').textContent, 'Updated 17:00:00 · Execution ended · auto refresh off');
  toggle.dispatchEvent(new Event('click'));
  assert.equal(screen.checkpoint().autoPaused, false);
  for (const state of ['hidden', 'visible']) {
    dom.document.visibilityState = state;
    dom.document.dispatchEvent(new Event('visibilitychange'));
  }
  t.mock.timers.tick(70000);
  await settle();
  assert.equal(calls.length, 2);
  dom.get('detail-refresh').dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(calls.slice(2), calls.slice(0, 2));
});

test('ending an execution returns focused Pause to Refresh and leaves other focus alone', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const target of ['detail-poll-toggle', 'overview-link']) {
    const dom = detailDOM();
    let ended = false;
    const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
      appBase: '/ops/app/', api: { async get(resource) {
        return resource.endsWith('/executables') ? observations() : ended ? detailResponse() : runningDetailResponse();
      } } });
    t.after(screen.dispose);
    await settle();
    dom.get(target).focus(); ended = true;
    t.mock.timers.tick(30000); await settle();
    assert.equal(dom.get('detail-poll-toggle').disabled, true);
    assert.equal(dom.document.activeElement, dom.get(target === 'detail-poll-toggle' ? 'detail-refresh' : target));
    screen.dispose();
  }
});

test('a retained Pause focus revalidating an ended execution restores to enabled Refresh', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM(), id = detailResponse().data.execution_id;
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: id, appBase: '/ops/app/',
    restoreView: { executionId: id, autoPaused: true, focus: 'toggle' },
    api: { async get(resource) { return resource.endsWith('/executables') ? observations() : detailResponse(); } } });
  t.after(screen.dispose); await settle();
  assert.equal(dom.get('detail-poll-toggle').disabled, true);
  assert.equal(dom.document.activeElement, dom.get('detail-refresh'));
});

test('a later running read restores the toggle and respects the retained user pause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const paused of [false, true]) {
    const dom = detailDOM();
    let ended = false, reads = 0;
    const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
      appBase: '/ops/app/', api: { async get(resource) {
        reads++; return resource.endsWith('/executables') ? observations() : ended ? detailResponse() : runningDetailResponse();
      } } });
    t.after(screen.dispose);
    await settle();
    const toggle = dom.get('detail-poll-toggle');
    if (paused) toggle.dispatchEvent(new Event('click'));
    ended = true;
    dom.get('detail-refresh').dispatchEvent(new Event('click'));
    await settle();
    assert.equal(toggle.disabled, true);
    assert.equal(screen.checkpoint().autoPaused, paused);
    ended = false;
    dom.get('detail-refresh').dispatchEvent(new Event('click'));
    await settle();
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.getAttribute('aria-label'), paused ? 'Resume auto refresh' : 'Pause auto refresh');
    assert.equal(toggle.title, toggle.getAttribute('aria-label'));
    assert.equal(dom.get('detail-poll-status').textContent,
      `Updated 17:00:00 · auto refresh ${paused ? 'paused' : 'on'}`);
    t.mock.timers.tick(30000);
    await settle();
    assert.equal(reads, paused ? 6 : 8);
    screen.dispose();
  }
});

test('ended cache return and fresh reload each refetch once without retaining a terminal flag or scheduling a timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = detailDOM();
  let reads = 0, checkpoint = null;
  for (const arrival of ['initial', 'cache', 'reload']) {
    const before = reads;
    const screen = mountDetail(dom.root, { metadata: metadata(), executionId: detailResponse().data.execution_id,
      appBase: '/ops/app/', restoreView: arrival === 'cache' ? checkpoint : null,
      api: { async get(resource) { reads++; return resource.endsWith('/executables') ? observations() : detailResponse(); } } });
    t.after(screen.dispose);
    await settle();
    assert.equal(reads, before + 2, arrival);
    assert.equal(dom.get('detail-poll-toggle').disabled, true);
    checkpoint = screen.checkpoint();
    assert.equal(checkpoint.autoPaused, false);
    assert.equal(Object.hasOwn(checkpoint, 'terminal'), false);
    t.mock.timers.tick(70000);
    await settle();
    assert.equal(reads, before + 2, arrival);
    screen.dispose();
  }
});
