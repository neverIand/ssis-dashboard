import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogSearch } from '../src/catalog-search.js';
import { ApiError } from '../src/api.js';
import { deferred, envelope } from './fixtures.js';
const page = (names, next = null) => ({ ...envelope(names.map(name => ({ folder_id: String(name.length), name, description: null }))),
  meta: { ...envelope().meta, from: null, to: null, limit: 2, sort: 'name', direction: 'asc', has_more: next !== null, next_cursor: next } });
const settled = () => new Promise(resolve => setImmediate(resolve));
const catalogPage = (kind, rows, limit, next = null) => ({ ...envelope(rows.map(({ id, name }) => kind === 'folders'
  ? { folder_id: id, name, description: null }
  : { project_id: id, folder_id: '9', folder_name: 'Exact\r\nfolder', name, description: null })),
  meta: { ...envelope().meta, from: null, to: null, limit, sort: 'name', direction: 'asc',
    has_more: next !== null, next_cursor: next } });

for (const kind of ['folders', 'projects']) test(`${kind} term scans read 1000 rows in five max-limit requests per continuation`, async t => {
  const calls = [], states = [];
  const owner = createCatalogSearch({ kind, limit: 50, maxLimit: 200, publish: state => states.push(state), api: { async get(resource, { params }) {
    calls.push({ resource, ...params });
    const start = Number(params.cursor ?? 0);
    return catalogPage(kind, Array.from({ length: params.limit }, (_, index) => ({ id: String(start + index + 1), name: 'Other' })),
      params.limit, String(start + params.limit));
  } } }); t.after(() => owner.dispose());
  const folder = kind === 'projects' ? 'Exact\r\nfolder' : null;
  await owner.search('missing', folder);
  assert.equal(calls.length, 5); assert.equal(states.at(-1).complete, false);
  assert.equal(states.at(-1).rows.length, 0);
  assert.deepEqual(calls.map(call => call.cursor), [null, '200', '400', '600', '800']);
  assert.ok(calls.every(call => call.limit === 200 && call.folder === folder && call.resource === kind));
  await owner.more(); assert.equal(calls.length, 10); assert.equal(calls[5].cursor, '1000');
  await owner.search('', folder);
  assert.equal(calls.length, 11); assert.equal(calls.at(-1).limit, 50); assert.equal(calls.at(-1).cursor, null);
  await owner.more(); assert.equal(calls.length, 12); assert.equal(calls.at(-1).limit, 50); assert.equal(calls.at(-1).cursor, '50');
});

test('max-limit search stops on matches or exhaustion and rounds a non-divisible row budget to a full cursor page', async t => {
  for (const [limit, maxLimit, expected] of [[37, 200, 4], [1, 200, 1], [50, 50, 20]]) {
    const calls = [], states = []; let mode = 'scan';
    const owner = createCatalogSearch({ kind: 'folders', limit, maxLimit, publish: state => states.push(state), api: { async get(kind, { params }) {
      calls.push(params);
      return catalogPage(kind, Array.from({ length: mode === 'match' ? limit : 1 }, (_, index) =>
        ({ id: String(index + 1), name: mode === 'match' ? 'MATCH' : 'Other' })),
        params.limit, mode === 'end' ? null : String(calls.length));
    } } }); t.after(() => owner.dispose());
    await owner.search('missing'); assert.equal(calls.length, expected);
    assert.ok(calls.every(call => call.limit === maxLimit));
    mode = 'end'; await owner.search('missing'); assert.equal(calls.length, expected + 1);
    assert.equal(states.at(-1).complete, true);
    mode = 'match'; await owner.search('match');
    assert.equal(calls.length, expected + 2, 'A default page of matches ends the scan');
    assert.equal(states.at(-1).rows.length, limit);
  }
});

test('a superseded max-limit continuation cannot publish or advance the next folder generation', async t => {
  const late = deferred(), calls = [], states = [];
  const owner = createCatalogSearch({ kind: 'projects', limit: 2, maxLimit: 4, publish: state => states.push(state), api: { get(kind, options) {
    calls.push(options);
    if (calls.length === 1) return Promise.resolve(catalogPage(kind, [{ id: '1', name: 'Old' }, { id: '2', name: 'Old two' }], 4, 'old-next'));
    if (calls.length === 2) return late.promise;
    return Promise.resolve(catalogPage(kind, [{ id: '3', name: 'New' }], 4));
  } } }); t.after(() => owner.dispose());
  await owner.search('old', 'Old folder'); const continuation = owner.more();
  await owner.search('new', 'New folder');
  const count = states.length;
  late.resolve(catalogPage('projects', [{ id: '4', name: 'Old late' }], 4, 'stale-next')); await continuation;
  assert.equal(calls[1].signal.aborted, true); assert.equal(states.length, count);
  assert.deepEqual(states.at(-1).rows.map(row => row.name), ['New']);
  assert.equal(calls[2].params.cursor, null); assert.equal(calls[2].params.folder, 'New folder');
  assert.ok(calls.every(call => call.params.limit === 4));
  await owner.more(); assert.equal(calls.length, 3, 'An obsolete cursor cannot revive an exhausted search');
});

test('cancel and dispose discard late max-limit scan successes and errors', async t => {
  for (const action of ['cancel', 'dispose']) for (const reject of [false, true]) {
    const late = deferred(), calls = [], states = [];
    const owner = createCatalogSearch({ kind: 'folders', limit: 2, maxLimit: 4, publish: state => states.push(state), api: { get(kind, options) {
      calls.push(options); return late.promise;
    } } }); t.after(() => owner.dispose());
    const job = owner.search('missing'), count = states.length;
    owner[action]();
    if (reject) late.reject(new ApiError('http', { status: 403 }));
    else late.resolve(catalogPage('folders', [{ id: '1', name: 'Missing' }], 4, 'late'));
    await job;
    assert.equal(calls[0].signal.aborted, true); assert.equal(calls[0].params.limit, 4);
    assert.equal(calls.length, 1); assert.equal(states.length, count);
  }
});

test('max-limit scans still reject cursor loops before appending that page', async t => {
  const calls = [], states = [];
  const owner = createCatalogSearch({ kind: 'folders', limit: 2, maxLimit: 4, publish: state => states.push(state), api: { async get(kind, { params }) {
    calls.push(params); return catalogPage(kind, [{ id: String(calls.length), name: 'Other' }], 4, 'loop');
  } } }); t.after(() => owner.dispose());
  await owner.search('missing'); assert.equal(calls.length, 2);
  assert.equal(states.at(-1).error.kind, 'invalid_response'); assert.equal(states.at(-1).rows.length, 0);
});

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
