import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { parameterQuery, readParameterPage } from '../src/values.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred } from './fixtures.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventMetadata, eventPage } from './event-fixture.js';
import { parameterMetadata, parameterPage, parameterRow } from './parameter-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const metadata = parameterMetadata(), query = { section: 'parameters', limit: 50 };
const display = createDisplay({ timeZone: metadata.display_timezone });
const response = resource => resource.endsWith('/values') ? parameterPage() : resource.endsWith('/events') ? eventPage()
  : resource.endsWith('/children') ? childPage() : resource.endsWith('/executables') ? executablePage() : detailResponse(resource.split('/')[1]);
function setup(t, get = async resource => response(resource), options = {}) {
  const calls = [], states = [];
  const owner = createDetailLoader({ executionId: '17', metadata, autoRefresh: false, ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } }, publish: state => states.push(state) });
  t.after(() => owner.dispose()); return { owner, calls, get state() { return states.at(-1); } };
}
function screen(t, get, options = {}) {
  const dom = detailDOM(), calls = [];
  const mounted = mountDetail(dom.root, { executionId: '17', metadata, appBase: '/ops/app/', ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(() => mounted.dispose()); return { ...dom, mounted, calls };
}

test('parameters support only their section and bounded size, with no invented sort or search', () => {
  assert.deepEqual(parameterQuery({ limit: 8 }, metadata), { section: 'parameters', limit: 8 });
  for (const changes of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { section: 'overrides' }, { sort: 'name' }, { direction: 'desc' }]) {
    assert.throws(() => parameterQuery({ ...query, ...changes }, metadata));
  }
});

test('parameter DTO keeps BIGINT order, exact names/types/value strings, NULL, empty and both redaction reasons', () => {
  const rows = [parameterRow('9007199254740993', { value: null }), parameterRow('9007199254740994', { value: '', sql_type: '' }),
    parameterRow('9007199254740995', { value: null, sensitive: true, redacted: true, redaction_reason: 'sensitive' }),
    parameterRow('9007199254740996', { value: null, redacted: true, redaction_reason: 'policy' }),
    parameterRow('9223372036854775807', { value: '😀'.repeat(16384), truncated: true, sql_type: 'Unknown future type', object_type: { code: -32768, name: 'unknown' } })];
  const page = parameterPage(rows);
  assert.equal(readParameterPage(page, '17', query, metadata, display), page);
  assert.equal(page.data[4].value.length, 32768);
  for (const value of ['0', '1.2300', '0xFF00', '2026-10-24T01:02:03.1234567', '<b>literal</b>\r\n尾 ']) {
    assert.equal(readParameterPage(parameterPage([parameterRow('1', { value })]), '17', query, metadata, display).data[0].value, value);
  }
});

test('malformed flags, identities, section/order/fence and leaked redacted text fail closed before conversion', () => {
  let converted = false;
  const unsafe = { toString() { converted = true; throw new Error('must not stringify'); } };
  const mutations = [p => { p.meta.section = 'overrides'; }, p => { p.meta.sort = 'name'; }, p => { p.meta.direction = 'desc'; },
    p => { p.data[0].execution_parameter_id = null; }, p => { p.data[0].execution_parameter_id = '0'; },
    p => { p.data[0].execution_parameter_id = '3'; p.meta.upper_id = '2'; }, p => { p.data.push(p.data[0]); },
    p => { p.data[0].name = ''; }, p => { p.data[0].name = 'x\0y'; }, p => { p.data[0].name = '😀'.repeat(65); },
    p => { p.data[0].sql_type = null; }, p => { p.data[0].object_type = { code: 30, name: 'project' }; },
    p => { p.data[0].value_set = 1; }, p => { p.data[0].required = null; }, p => { p.data[0].runtime_override = 'false'; },
    p => { p.data[0].value = {}; }, p => { p.data[0].value = '\ud800'; }, p => { p.data[0].truncated = true; },
    p => { Object.assign(p.data[0], { sensitive: true, redacted: true, redaction_reason: 'policy', value: null }); },
    p => { Object.assign(p.data[0], { redacted: true, redaction_reason: 'policy', value: unsafe }); },
    p => { Object.assign(p.data[0], { sensitive: true, value: unsafe }); }];
  for (const mutate of mutations) {
    const page = parameterPage(); mutate(page);
    assert.throws(() => readParameterPage(page, '17', query, metadata, display), error => error.kind === 'invalid_response');
  }
  assert.equal(converted, false);
  assert.throws(() => readParameterPage(parameterPage([parameterRow('2'), parameterRow('1')]), '17', query, metadata, display));
});

test('disabled capability discards restored parameters and all programmatic reads while other detail work continues', async t => {
  const run = setup(t, undefined, { metadata: parameterMetadata(false), restoreParameters: { open: true, query, path: { entries: ['private-old'], index: 0 } } });
  await run.owner.load(); await run.owner.section('parameters').select(); await run.owner.section('parameters').retry(); await run.owner.section('parameters').latest();
  await run.owner.section('parameters').order({ limit: 8 }); await run.owner.refresh();
  assert.equal(run.calls.length, 2); assert.equal(run.state.parameters.open, false); assert.equal(run.state.parameters.page, null);
});

test('parameters page independently and share a five-read serial refresh with exact API query parameters', async t => {
  const allMetadata = eventMetadata(); allMetadata.capabilities.values = true;
  const run = setup(t, async (resource, { params }) => resource.endsWith('/values') ? parameterPage([parameterRow(params.cursor ? '2' : '1')],
    { limit: params.limit, has_more: !params.cursor, next_cursor: params.cursor ? null : 'parameter-next' }) : response(resource), { metadata: allMetadata });
  await run.owner.load(); assert.equal(run.calls.length, 1);
  await run.owner.section('executables').select(); await run.owner.section('children').select(); await run.owner.section('events').select(); await run.owner.section('parameters').select();
  await run.owner.section('parameters').next(); assert.equal(run.state.parameters.pageNumber, 2); assert.equal(run.state.events.pageNumber, 1);
  const start = run.calls.length; await run.owner.refresh();
  assert.deepEqual(run.calls.slice(start).map(call => call.resource), ['executions/17','executions/17/executables','executions/17/children','executions/17/events','executions/17/values']);
  assert.deepEqual(run.calls.at(-1).params, { section: 'parameters', limit: 50, cursor: 'parameter-next' });
  await run.owner.section('parameters').order({ limit: 8 }); assert.deepEqual(run.calls.at(-1).params, { section: 'parameters', limit: 8 });
  assert.equal(run.state.parameters.pageNumber, 1); await run.owner.section('parameters').next(); await run.owner.section('parameters').previous();
  assert.equal(run.state.parameters.pageNumber, 1); await run.owner.section('parameters').latest(); assert.equal(run.state.parameters.pageNumber, 1);
});

test('queued parameters survive event-search cancellation and closing in-flight values preserves queued sibling work', async t => {
  const old = deferred(), value = deferred(), allMetadata = eventMetadata(); allMetadata.capabilities.values = true;
  const run = setup(t, (resource, { params }) => resource.endsWith('/events') && params.q === 'old' ? old.promise
    : resource.endsWith('/values') ? value.promise : Promise.resolve(response(resource)), { metadata: allMetadata });
  await run.owner.load(); await run.owner.section('events').select(); const searching = run.owner.section('events').applyEvents({ q: 'old' });
  await run.owner.section('parameters').select(); const replacing = run.owner.section('events').applyEvents({ q: 'new' }); await flush();
  assert.equal(run.calls.at(-1).resource, 'executions/17/values');
  await run.owner.section('children').select(); await run.owner.section('parameters').select(); await flush();
  assert.equal(run.calls.at(-1).resource, 'executions/17/children');
  value.reject(new ApiError('http', { status: 404 })); old.reject(new ApiError('http', { status: 403 })); await Promise.all([searching, replacing]);
  assert.equal(run.state.phase, 'ready'); assert.equal(run.state.parameters.open, false); assert.ok(run.state.children.page);
});

test('parameter transient failures retain only their current page; denial/malformed clear it and 404 clears execution', async t => {
  for (const failure of [new ApiError('http', { status: 503 }), new ApiError('http', { status: 403 }), new ApiError('invalid_response'), new ApiError('http', { status: 404 })]) {
    let failed = false;
    const run = setup(t, async resource => { if (failed && resource.endsWith('/values')) throw failure; return response(resource); });
    await run.owner.load(); await run.owner.section('parameters').select(); failed = true; await run.owner.refresh();
    assert.equal(run.state.parameters.page !== null, failure.status === 503);
    assert.equal(run.state.response === null, failure.status === 404);
    if (failure.status === 503) { failed = false; await run.owner.section('parameters').retry(); assert.equal(run.state.parameters.error, null); }
  }
});

test('a restored cursor invalidated by policy resets once and a failed fallback cannot retain old values', async t => {
  let reads = 0;
  const run = setup(t, async (resource, { params }) => {
    if (!resource.endsWith('/values')) return response(resource);
    reads++; if (params.cursor) throw new ApiError('http', { status: 400, code: 'invalid_cursor' });
    throw new ApiError('http', { status: 503 });
  }, { restoreParameters: { open: true, query, path: { entries: [null, 'old-policy'], index: 1, cohort: { as_of: 'old', upper_id: '10' } } } });
  await run.owner.load(); assert.equal(reads, 2); assert.equal(run.state.parameters.pageNumber, 1);
  assert.equal(run.state.parameters.page, null); assert.equal(run.state.parameters.error.status, 503);
  assert.deepEqual(run.calls.at(-1).params, query);
});

test('parameter deadlines, A to B to A generations and disposal reject late reads without leaking values', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = [], run = setup(t, (resource, options) => {
    if (!resource.endsWith('/values')) return Promise.resolve(response(resource));
    const wait = deferred(); pending.push({ ...wait, signal: options.signal }); return wait.promise;
  }, { timeoutMs: 20 });
  await run.owner.load(); const first = run.owner.section('parameters').select(); await flush();
  const b = run.owner.select('18'); await flush(); const a = run.owner.select('17'); await flush();
  pending[0].reject(new ApiError('http', { status: 404 })); pending[1].resolve(parameterPage([parameterRow('2')]));
  pending[2].resolve(parameterPage([parameterRow('3')])); await Promise.all([first,b,a]);
  assert.equal(run.state.executionId, '17'); assert.equal(run.state.parameters.page.data[0].execution_parameter_id, '3');
  const late = run.owner.refresh(); await flush(); t.mock.timers.tick(20); assert.equal(pending[3].signal.aborted, true);
  pending[3].reject(new Error('aborted')); await late; assert.equal(run.state.parameters.error.kind, 'timeout');
  const disposed = run.owner.section('parameters').retry(); await flush(); const lastPublished = run.state;
  run.owner.dispose(); pending[4].resolve(parameterPage()); await disposed;
  assert.equal(run.state, lastPublished); assert.equal(run.owner.section('parameters').checkpoint().open, false);
});

test('the completion-based scheduler coalesces refresh and visibility recovery behind pending parameter work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const wait = deferred(); let delay = true;
  const run = setup(t, resource => resource === 'executions/17' ? runningDetailResponse('17') : resource.endsWith('/values') && delay ? wait.promise : Promise.resolve(response(resource)), { autoRefresh: true, pollIntervalMs: 100 });
  await run.owner.load(); const opening = run.owner.section('parameters').select(); await flush(); t.mock.timers.tick(1000);
  await run.owner.refresh(); run.owner.setVisible(false); run.owner.setVisible(true); await flush(); assert.equal(run.calls.length, 2);
  delay = false; wait.resolve(parameterPage()); await opening; await flush();
  const beforeResync = run.calls.length; t.mock.timers.tick(0); await flush(); assert.equal(run.calls.length, beforeResync + 2);
  const after = run.calls.length; t.mock.timers.tick(99); await flush(); assert.equal(run.calls.length, after);
  t.mock.timers.tick(1); await flush(); assert.equal(run.calls.length, after + 2);
});

test('parameter UI renders literal types/flags and distinct redacted, NULL, empty and truncated values', async t => {
  const rows = [parameterRow('1', { value: '<b>literal</b>\r\n尾 '.repeat(20) }), parameterRow('2', { value: null }),
    parameterRow('3', { value: '' }), parameterRow('4', { value: null, sensitive: true, redacted: true, redaction_reason: 'sensitive' }),
    parameterRow('5', { value: null, redacted: true, redaction_reason: 'policy' }),
    parameterRow('6', { value: '😀'.repeat(16384), truncated: true, object_type: { code: -1, name: 'unknown' } })];
  const dom = screen(t, async resource => resource.endsWith('/values') ? parameterPage(rows) : response(resource));
  await flush(); assert.equal(dom.get('parameters-panel').hidden, true);
  dom.get('parameters-toggle').dispatchEvent(new Event('click')); await flush(); const text = dom.parameterBody.textContent;
  for (const value of ['Decimal(18,4)', 'NULL (unredacted)', '(empty)', 'Redacted (sensitive)', 'Redacted (policy)', 'Unknown (-1)', 'Truncated to 16384 characters.']) assert.ok(text.includes(value));
  const first = dom.parameterBody.children[0]; assert.equal(first.children[0].children[0].textContent, rows[0].name);
  assert.equal(first.children[3].children[2].children[1].textContent, rows[0].value);
  assert.deepEqual(first.children[4].children[0].children.filter(node => !node.hidden).map(node => node.textContent), ['Required', 'Value set']);
  assert.equal(first.title, 'Parameter ID: 1'); assert.equal(first.children[0].children.length, 1);
});

test('a keyed value becoming redacted clears expanded raw text and moves hidden-value focus to its table', async t => {
  let redacted = false;
  const dom = screen(t, async resource => resource.endsWith('/values') ? parameterPage([parameterRow('1', redacted
    ? { value: null, sensitive: true, redacted: true, redaction_reason: 'sensitive' } : { value: 'private-ordinary-value '.repeat(20) })]) : response(resource));
  await flush(); dom.get('parameters-toggle').dispatchEvent(new Event('click')); await flush();
  const row = dom.parameterBody.children[0], value = row.children[3].children[2], flags = row.children[4].children[0];
  value.open = true; dom.get('parameters-scroll').scrollLeft = 120; dom.get('parameters-scroll').scrollTop = 75;
  redacted = true; dom.get('detail-refresh').dispatchEvent(new Event('click')); value.children[0].focus(); await flush();
  assert.equal(dom.parameterBody.children[0], row); assert.equal(value.open, false); assert.equal(row.children[4].children[0], flags);
  assert.equal(flags.firstChild.textContent, 'Sensitive'); assert.equal(flags.firstChild.hidden, false);
  assert.doesNotMatch(row.textContent, /private-ordinary-value/); assert.equal(value.children[1].textContent, '');
  assert.equal(dom.document.activeElement, dom.get('parameters-scroll')); assert.equal(dom.get('parameters-scroll').scrollLeft, 120);
});

test('invalid redaction clears all parameter DOM text and 404 clears the visible execution heading', async t => {
  let mode = 'valid';
  const dom = screen(t, async resource => {
    if (!resource.endsWith('/values')) return response(resource);
    if (mode === '404') throw new ApiError('http', { status: 404 });
    return parameterPage([parameterRow('1', mode === 'invalid' ? { sensitive: true, value: 'forbidden-canary' } : {})]);
  });
  await flush(); dom.get('parameters-toggle').dispatchEvent(new Event('click')); await flush(); mode = 'invalid'; dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  assert.doesNotMatch(dom.parameterBody.textContent, /1\.2300|forbidden-canary/); assert.equal(dom.field('package').textContent, 'Main.dtsx');
  mode = '404'; dom.get('parameters-retry').dispatchEvent(new Event('click')); await flush(); assert.equal(dom.field('package').textContent, 'Execution 17'); assert.equal(dom.field('status').hidden, true);
});

test('parameter checkpoints keep only IDs/view state and disabled or changed metadata revalidates before restoration', async t => {
  const dom = screen(t, async resource => resource.endsWith('/values') ? parameterPage([parameterRow('1', { name: 'private-name-canary', value: 'private-value-canary '.repeat(20) })]) : response(resource));
  await flush(); dom.get('parameters-toggle').dispatchEvent(new Event('click')); await flush();
  const value = dom.parameterBody.children[0].children[3].children[2]; value.open = true; value.children[0].focus();
  const checkpoint = dom.mounted.checkpoint(); assert.doesNotMatch(JSON.stringify(checkpoint), /private-name-canary|private-value-canary|sql_type|redaction_reason/);
  dom.mounted.dispose();
  const blocked = screen(t, async resource => response(resource), { metadata: parameterMetadata(false), restoreView: checkpoint }); await flush();
  assert.equal(blocked.calls.length, 2); assert.equal(blocked.get('parameters-panel').hidden, true); assert.equal(blocked.get('parameters-toggle').disabled, true);
  const changed = screen(t, async resource => response(resource), { restoreView: checkpoint }); await flush();
  assert.equal(changed.calls.at(-1).resource, 'executions/17/values'); assert.ok(changed.parameterBody.textContent.includes('1.2300'));
  assert.doesNotMatch(changed.parameterBody.textContent, /private-value-canary/); assert.equal(changed.document.activeElement, changed.get('parameters-scroll'));
});

test('invalid sizes remain editable, busy size changes cannot mislabel the applied page, and disposal removes handlers', async t => {
  const wait = deferred(); let slow = false;
  const dom = screen(t, resource => resource.endsWith('/values') && slow ? wait.promise : Promise.resolve(response(resource)));
  await flush(); dom.get('parameters-toggle').dispatchEvent(new Event('click')); await flush();
  dom.get('parameters-limit').value = '201'; dom.get('parameters-limit').dispatchEvent(new Event('change'));
  assert.match(dom.get('parameters-notice').textContent, /between 1 and 200/);
  const count = dom.calls.length; slow = true; dom.get('detail-refresh').dispatchEvent(new Event('click')); await flush();
  dom.get('parameters-limit').value = '8'; dom.get('parameters-limit').dispatchEvent(new Event('change'));
  assert.equal(dom.get('parameters-limit').value, '50'); assert.equal(dom.calls.length, count + 2);
  dom.get('overview-link').focus(); wait.resolve(parameterPage()); await flush(); assert.equal(dom.document.activeElement, dom.get('overview-link'));
  dom.mounted.dispose(); const closed = dom.calls.length; dom.get('parameters-toggle').dispatchEvent(new Event('click')); assert.equal(dom.calls.length, closed); assert.equal(dom.parameterBody.textContent, '');
});
