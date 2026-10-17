import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer, mergeConfig } from 'vite';
import config from '../vite.config.js';

test('production assets are present for Flask packaging', async () => {
  const output = new URL('../../dashboard/static/app/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
  const entry = manifest['src/main.js'];
  assert.equal(entry.isEntry, true);
  assert.ok(entry.css.length > 0);
  for (const filename of [entry.file, ...entry.css, 'LICENSES.txt']) {
    await access(new URL(filename, output));
  }
});

test('development serves modules and proxies API requests on the same origin', async (t) => {
  const requests = [];
  const backend = createHttpServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ developmentProxy: true }));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    backend.close((error) => error ? reject(error) : resolve());
    backend.closeAllConnections();
  }));

  const server = await createServer(mergeConfig(config, {
    configFile: false,
    logLevel: 'silent',
    server: {
      port: 0,
      proxy: {
        '^/api/v1(?:/|$)': `http://127.0.0.1:${backend.address().port}`,
      },
    },
  }));
  t.after(() => server.close());
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/src\/main.js"/);
  for (const path of ['/src/main.js', '/src/styles.css', '/@vite/client']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0, path);
  }

  const apiPath = '/api/v1/meta?probe=%E6%B5%8B%E8%AF%95%2B%2F';
  const api = await fetch(`${origin}${apiPath}`);
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { developmentProxy: true });
  assert.deepEqual(requests, [apiPath]);
  for (const path of ['/api/v10/meta', '/missing']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    await response.text();
  }
  assert.deepEqual(requests, [apiPath]);
});
