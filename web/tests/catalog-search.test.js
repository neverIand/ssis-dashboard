import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogSearch } from '../src/catalog-search.js';
import { ApiError } from '../src/api.js';
import { deferred, envelope } from './fixtures.js';
const page = (names, next = null) => ({ ...envelope(names.map(name => ({ folder_id: String(name.length), name, description: null }))),
  meta: { ...envelope().meta, from: null, to: null, limit: 2, sort: 'name', direction: 'asc', has_more: next !== null, next_cursor: next } });
const settled = () => new Promise(resolve => setImmediate(resolve));

test('search reaches matches after the first page and distinguishes exhausted from partially scanned catalogs', async t => {
  const calls = [], states = [];
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, publish: state => states.push(state), api: { async get(kind, { params }) {
    calls.push(params); return params.cursor ? page(['Tokyo 東京']) : page(['First'], 'next');
  } } }); t.after(() => owner.dispose());
  await owner.search('東京'); assert.equal(calls.length, 2);
  assert.deepEqual(states.at(-1).rows.map(row => row.name), ['Tokyo 東京']); assert.equal(states.at(-1).complete, true);
  assert.equal(calls[1].cursor, 'next');
});

test('empty browse waits for Load more; search has a finite scan budget and a continuation', async t => {
  const states = [], calls = [];
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, pageBudget: 2, publish: state => states.push(state), api: { async get(kind, { params }) {
    calls.push(params); return page(['Different'], String(calls.length));
  } } }); t.after(() => owner.dispose());
  await owner.search(); assert.equal(calls.length, 1);
  await owner.search('No match'); assert.equal(calls.length, 3);
  assert.equal(states.at(-1).complete, false); assert.equal(states.at(-1).rows.length, 0);
  await owner.more(); assert.equal(calls.length, 5);
});

test('new searches cancel and ignore late results; exact folder names are passed unchanged', async t => {
  const first = deferred(), states = [], calls = [];
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, publish: state => states.push(state), api: { get(kind, options) {
    calls.push(options); return calls.length === 1 ? first.promise : Promise.resolve(page(['New result']));
  } } }); t.after(() => owner.dispose());
  const old = owner.search('old'); await owner.search('New'); first.resolve(page(['old result'])); await old;
  assert.equal(calls[0].signal.aborted, true); assert.equal(states.at(-1).rows[0].name, 'New result');
  let folder;
  const projects = createCatalogSearch({ kind: 'projects', limit: 2, publish() {}, api: { async get(kind, options) {
    folder = options.params.folder; return { ...page([]), data: [] };
  } } }); t.after(() => projects.dispose());
  await projects.search('x'); assert.equal(folder, undefined);
  await projects.search('', 'Fold\r\ner'); assert.equal(folder, 'Fold\r\ner');
});

test('cursor expiry restarts at page one; access denial clears existing choices', async t => {
  const states = [], calls = []; let fail = false;
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, publish: state => states.push(state), api: { async get(kind, { params }) {
    calls.push(params);
    if (fail) throw new ApiError('http', { status: 403 });
    if (params.cursor) throw new ApiError('http', { status: 400, code: 'cursor_expired' });
    return page(['Alpha'], 'cursor');
  } } }); t.after(() => owner.dispose());
  await owner.search(); await owner.more(); assert.equal(states.at(-1).error.code, 'cursor_expired');
  await owner.retry(); assert.equal(calls.at(-1).cursor, null);
  fail = true; await owner.more(); assert.equal(states.at(-1).rows.length, 0);
});

test('timeouts and disposal release pending work without late publications', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), states = []; let signal;
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, timeoutMs: 10, publish: state => states.push(state), api: { get(kind, options) {
    signal = options.signal; return pending.promise;
  } } });
  const job = owner.search(); t.mock.timers.tick(10); assert.equal(signal.aborted, true);
  pending.resolve(page([])); await job; assert.equal(states.at(-1).error.kind, 'timeout');
  owner.dispose(); const count = states.length; await owner.more(); await settled(); assert.equal(states.length, count);
});
