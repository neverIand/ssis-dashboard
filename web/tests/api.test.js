import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { ApiError, createApi } from '../src/api.js';
import { deferred, envelope, jsonResponse, requestId, wireTime } from './fixtures.js';

const origin = 'http://127.0.0.1:5000';

test('same-origin GET preserves prefix, exact wire values and literal name encoding', async () => {
  let observed;
  const data = { execution_id: '9223372036854775807', started_at: wireTime, optional: null };
  const api = createApi('/dashboard/api/v1/', { origin, fetchImpl: async (url, options) => {
    observed = { url, options };
    return jsonResponse(envelope(data));
  } });
  const params = { folder: 'all + / 测试 %_*[x]', from: wireTime, cursor: 'opaque+/=&',
    limit: 50, status: undefined, project: null };
  const result = await api.get('executions', { params });
  assert.deepEqual(result.data, data);
  assert.equal(observed.url.pathname, '/dashboard/api/v1/executions');
  for (const key of ['folder', 'from', 'cursor']) assert.equal(observed.url.searchParams.get(key), params[key]);
  assert.match(observed.url.search, /%2B/);
  assert.equal(observed.url.searchParams.has('status'), false);
  assert.equal(observed.url.searchParams.has('project'), false);
  assert.deepEqual(observed.options, {
    method: 'GET', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
    redirect: 'error', headers: { Accept: 'application/json' }, signal: undefined,
  });
  assert.equal(params.from, wireTime);
});

test('cross-origin and prefix escapes are rejected before fetch', async () => {
  let calls = 0;
  const options = { origin, fetchImpl: async () => { calls += 1; } };
  for (const base of ['https://outside.invalid/api/v1/', '/api/v1/?x=y', '/api/v1/#x', '/api/v1']) {
    assert.throws(() => createApi(base, options), TypeError);
  }
  const api = createApi('/dashboard/api/v1/', options);
  for (const resource of ['https://outside.invalid/meta', '/api/v1/meta', '../meta',
    '%2e%2e/meta', 'meta#fragment', 'http://user:password@127.0.0.1:5000/dashboard/api/v1/meta']) {
    await assert.rejects(api.get(resource), TypeError);
  }
  await assert.rejects(api.get('meta', { params: { bad: { secret: true } } }), TypeError);
  assert.equal(calls, 0);
});

test('safe problem handling retains status/code/correlation without echoing diagnostics', async () => {
  for (const status of [400, 401, 403, 404, 405, 500, 503, 504]) {
    const api = createApi('/api/v1/', { origin, fetchImpl: async () => jsonResponse({
      status, code: 'cursor_expired', request_id: requestId,
      title: '<script>private diagnostic</script>', detail: 'private connection string',
    }, { status, headers: { 'Content-Type': 'application/problem+json' } }) });
    await assert.rejects(api.get('executions'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, 'cursor_expired');
      assert.equal(error.requestId, requestId);
      assert.doesNotMatch(error.message, /private|script|connection/);
      return true;
    });
  }
});

test('non-JSON failures preserve HTTP denial and only valid request IDs', async () => {
  const api = createApi('/api/v1/', { origin, fetchImpl: async () => new Response('<html>private</html>', {
    status: 403, headers: { 'Content-Type': 'text/html', 'X-Request-ID': '<unsafe-id>' },
  }) });
  await assert.rejects(api.get('meta'), (error) => error.kind === 'http'
    && error.status === 403 && error.requestId === null && !error.message.includes('private'));
  const fallback = createApi('/api/v1/', { origin, fetchImpl: async () => jsonResponse({
    request_id: requestId, code: 'raw_secret',
  }, { status: 503, headers: { 'X-Request-ID': 'invalid' } }) });
  await assert.rejects(fallback.get('meta'), (error) => error.requestId === requestId && error.code === null);
});

test('invalid successes and network failures do not become empty/default resources', async () => {
  const bodies = [() => new Response('<html>private</html>'),
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    () => jsonResponse(null), () => jsonResponse({ data: [] }),
    () => jsonResponse({ data: [], meta: { request_id: 'bad', generated_at: wireTime } }),
    () => jsonResponse(envelope(), { headers: { 'X-Request-ID': 'a'.repeat(32) } })];
  for (const response of bodies) {
    const api = createApi('/api/v1/', { origin, fetchImpl: async () => response() });
    await assert.rejects(api.get('meta'), (error) => error.kind === 'invalid_response');
  }
  const api = createApi('/api/v1/', { origin, fetchImpl: async () => { throw new Error('private native detail'); } });
  await assert.rejects(api.get('meta'), (error) => error.kind === 'network' && !error.message.includes('private'));
});

test('abort before fetch and during JSON parsing cannot return a stale success', async () => {
  const before = new AbortController();
  before.abort('private reason');
  let calls = 0;
  const api = createApi('/api/v1/', { origin, fetchImpl: async () => { calls += 1; } });
  await assert.rejects(api.get('meta', { signal: before.signal }), { name: 'AbortError', message: 'Request cancelled.' });
  assert.equal(calls, 0);

  const body = deferred();
  const during = new AbortController();
  const pendingApi = createApi('/api/v1/', { origin, fetchImpl: async () => ({
    ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => body.promise,
  }) });
  const pending = pendingApi.get('meta', { signal: during.signal });
  await Promise.resolve();
  during.abort();
  body.resolve(envelope());
  await assert.rejects(pending, { name: 'AbortError' });
});

test('native fetch blocks redirects and cancels an outstanding request', async (t) => {
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/api/v1/pending') return;
    response.writeHead(302, { Location: '/login' });
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  const api = createApi('/api/v1/', { origin: localOrigin });
  await assert.rejects(api.get('meta'), (error) => error.kind === 'network');
  assert.deepEqual(paths, ['/api/v1/meta']);
  const arrived = once(server, 'request');
  const controller = new AbortController();
  const pending = api.get('pending', { signal: controller.signal });
  await arrived;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(paths, ['/api/v1/meta', '/api/v1/pending']);
});
