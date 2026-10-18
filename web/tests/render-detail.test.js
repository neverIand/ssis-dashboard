import assert from 'node:assert/strict';
import test from 'node:test';
import { mountBootstrap } from '../src/bootstrap.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, envelope, jsonResponse, requestId } from './fixtures.js';
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
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id }) });
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
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id }) });
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
    mountDetail(dom.root, { metadata, api, executionId: config.execution_id }) });
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
