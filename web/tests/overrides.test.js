import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { overrideQuery, readOverridePage } from '../src/values.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventPage } from './event-fixture.js';
import { parameterPage, parameterRow } from './parameter-fixture.js';
import { overrideMetadata, overridePage, overrideRow } from './override-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const metadata = overrideMetadata(), query = { section: 'overrides', limit: 50 };
const display = createDisplay({ timeZone: metadata.display_timezone });
const response = (resource, { params } = {}) => resource.endsWith('/values') ? (params.section === 'overrides' ? overridePage() : parameterPage())
  : resource.endsWith('/events') ? eventPage() : resource.endsWith('/children') ? childPage()
  : resource.endsWith('/executables') ? executablePage() : detailResponse(resource.split('/')[1]);
function setup(t, get = async (...args) => response(...args), options = {}) {
  const calls = [], states = [];
  const owner = createDetailLoader({ executionId: '17', metadata, autoRefresh: false, ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } }, publish: state => states.push(state) });
  t.after(() => owner.dispose()); return { owner, calls, states, get state() { return states.at(-1); } };
}
function screen(t, get = async (...args) => response(...args), options = {}) {
  const dom = detailDOM(), calls = [];
  const mounted = mountDetail(dom.root, { executionId: '17', metadata, appBase: '/ops/app/', ...options,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(() => mounted.dispose()); return { ...dom, mounted, calls };
}
const click = (dom, key) => dom.get(key).dispatchEvent(new Event('click'));

test('overrides use a bounded property-ID order and cannot borrow parameter section or sort controls', () => {
  assert.deepEqual(overrideQuery({ limit: 8 }, metadata), { section: 'overrides', limit: 8 });
  for (const changes of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { section: 'parameters' }, { sort: 'property_path' }, { direction: 'asc' }]) {
    assert.throws(() => overrideQuery({ ...query, ...changes }, metadata));
  }
});

test('override DTO retains exact UTF-16 paths, BIGINTs, Unicode values and distinct redaction/NULL/empty states', () => {
  const path = '😀'.repeat(2000), values = [null, '', '<b>literal</b>\r\n尾 ', '1.2300'];
  const rows = values.map((value, index) => overrideRow(String(9007199254740993n + BigInt(index)), { value, property_path: path }));
  rows.push(overrideRow('9223372036854775807', { value: '😀'.repeat(16384), truncated: true }));
  const page = overridePage(rows);
  assert.equal(readOverridePage(page, '17', query, metadata, display), page);
  assert.equal(page.data[0].property_path.length, 4000); assert.equal(page.data.at(-1).value.length, 32768);
  const policy = overrideMetadata(true, false), redacted = overridePage([
    overrideRow('1', { redacted: true, redaction_reason: 'policy', value: null }),
    overrideRow('2', { sensitive: true, redacted: true, redaction_reason: 'sensitive', value: null })]);
  assert.equal(readOverridePage(redacted, '17', query, policy, display), redacted);
});

test('wrong section, path, identity, redaction or policy fails closed without stringifying supplied values', () => {
  let converted = false;
  const unsafe = { toString() { converted = true; throw new Error('must not stringify'); } };
  const mutations = [p => { p.meta.section = 'parameters'; }, p => { p.meta.sort = 'execution_parameter_id'; },
    p => { p.meta.upper_id = '0'; }, p => { p.data[0].property_id = null; }, p => { p.data[0].property_id = '0'; },
    p => { p.data.push(p.data[0]); }, p => { p.data[0].property_path = ''; }, p => { p.data[0].property_path = null; },
    p => { p.data[0].property_path = 'x\0y'; }, p => { p.data[0].property_path = '😀'.repeat(2001); },
    p => { p.data[0].property_path = '\ud800'; }, p => { p.data[0].sensitive = 0; }, p => { p.data[0].value = '\ud800'; },
    p => { p.data[0].truncated = true; }, p => { p.data[0].redaction_reason = 'policy'; },
    p => { Object.assign(p.data[0], { sensitive: true, redacted: true, redaction_reason: 'policy', value: null }); },
    p => { Object.assign(p.data[0], { redacted: true, redaction_reason: 'sensitive', value: null }); },
    p => { Object.assign(p.data[0], { redacted: true, redaction_reason: 'policy', value: unsafe }); },
    p => { Object.assign(p.data[0], { sensitive: true, value: unsafe }); }];
  for (const mutate of mutations) {
    const page = overridePage(); mutate(page);
    assert.throws(() => readOverridePage(page, '17', query, metadata, display), error => error.kind === 'invalid_response');
  }
  assert.throws(() => readOverridePage(overridePage([overrideRow('1', { value: unsafe })]), '17', query, overrideMetadata(true, false), display));
  assert.equal(converted, false);
  assert.throws(() => readOverridePage(overridePage([overrideRow('2'), overrideRow('1')]), '17', query, metadata, display));
});

test('values capability blocks both value sections while override display policy permits redacted metadata', async t => {
  const restore = { open: true, query, path: { entries: [null, 'old-policy'], index: 1 } };
  const blocked = setup(t, undefined, { metadata: overrideMetadata(false), restoreOverrides: restore });
  await blocked.owner.load(); await blocked.owner.toggleOverrides(); await blocked.owner.toggleParameters();
  await blocked.owner.orderOverrides({ limit: 8 }); await blocked.owner.nextOverrides(); await blocked.owner.previousOverrides();
  await blocked.owner.retryOverrides(); await blocked.owner.latestOverrides(); await blocked.owner.refresh();
  assert.equal(blocked.calls.length, 2); assert.equal(blocked.state.overrides.open, false);
  const allowed = setup(t, async (resource, options) => resource.endsWith('/values') ? overridePage([overrideRow('1',
    { redacted: true, redaction_reason: 'policy', value: null })]) : response(resource, options), { metadata: overrideMetadata(true, false) });
  await allowed.owner.load(); await allowed.owner.toggleOverrides();
  assert.equal(allowed.state.overrides.page.data[0].redaction_reason, 'policy');
  assert.deepEqual(allowed.calls.at(-1).params, query);
});

test('parameters and overrides page independently within one six-read serial refresh and separate cursor cohorts', async t => {
  const all = overrideMetadata(); all.capabilities.events = true;
  let inFlight = 0, peak = 0;
  const run = setup(t, async (resource, options) => {
    peak = Math.max(peak, ++inFlight); await flush(); inFlight--;
    const params = options.params;
    if (!resource.endsWith('/values')) return response(resource, options);
    const page = params.section === 'overrides' ? overridePage : parameterPage, row = params.section === 'overrides' ? overrideRow : parameterRow;
    return page([row(params.cursor ? '2' : '1')], { limit: params.limit, has_more: !params.cursor, next_cursor: params.cursor ? null : `${params.section}-next` });
  }, { metadata: all });
  await run.owner.load(); await run.owner.toggleExecutables(); await run.owner.toggleChildren(); await run.owner.toggleEvents();
  await run.owner.toggleParameters(); await run.owner.toggleOverrides(); await run.owner.nextOverrides();
  assert.equal(run.state.overrides.pageNumber, 2); assert.equal(run.state.parameters.pageNumber, 1);
  await run.owner.nextParameters(); const start = run.calls.length; await run.owner.refresh();
  assert.deepEqual(run.calls.slice(start).map(call => call.params?.section ?? call.resource.split('/').at(-1)),
    ['17','executables','children','events','parameters','overrides']);
  assert.deepEqual(run.calls.at(-1).params, { ...query, cursor: 'overrides-next' }); assert.equal(peak, 1);
  await run.owner.orderOverrides({ limit: 8 }); assert.deepEqual(run.calls.at(-1).params, { section: 'overrides', limit: 8 });
  assert.equal(run.state.parameters.pageNumber, 2); await run.owner.nextOverrides(); await run.owner.previousOverrides();
  await run.owner.latestOverrides(); assert.equal(run.state.overrides.pageNumber, 1);
});

test('invalid policy cursors reset once to redacted metadata and cannot retain values after failed fallback', async t => {
  for (const fail of [false, true]) {
    let changed = false;
    const run = setup(t, async (resource, options) => {
      if (!resource.endsWith('/values')) return response(resource, options);
      if (changed && options.params.cursor) throw new ApiError('http', { status: 400, code: 'invalid_cursor' });
      if (changed && fail) throw new ApiError('http', { status: 503 });
      return overridePage([overrideRow(options.params.cursor ? '2' : '1', changed ? { redacted: true, redaction_reason: 'policy', value: null } : {})],
        { has_more: !changed && !options.params.cursor, next_cursor: !changed && !options.params.cursor ? 'old-policy' : null });
    });
    await run.owner.load(); await run.owner.toggleOverrides(); await run.owner.nextOverrides();
    changed = true; const start = run.calls.length; await run.owner.refresh();
    assert.equal(run.calls.length - start, 3); assert.equal(run.state.overrides.pageNumber, 1);
    assert.equal(run.state.overrides.page?.data[0].redaction_reason ?? null, fail ? null : 'policy');
    assert.equal(run.state.overrides.stale, false);
    assert.ok(run.states.some(state => state.overrides.notice.includes('Reset to page one')));
    assert.doesNotMatch(JSON.stringify(run.state.overrides.page), /1\.2300/);
  }
});

test('override failures isolate siblings, correlate errors and clear the whole detail only on 404', async t => {
  for (const failure of [new ApiError('http', { status: 503 }), new ApiError('http', { status: 403 }), new ApiError('invalid_response'), new ApiError('http', { status: 404 })]) {
    let failed = false;
    const run = setup(t, async (resource, options) => {
      if (failed && options.params?.section === 'overrides') throw failure; return response(resource, options);
    });
    await run.owner.load(); await run.owner.toggleParameters(); await run.owner.toggleOverrides(); failed = true; await run.owner.refresh();
    assert.equal(run.state.overrides.page !== null, failure.status === 503);
    assert.equal(run.state.parameters.page !== null, failure.status !== 404); assert.equal(run.state.response === null, failure.status === 404);
    if (failure.status === 503) { failed = false; await run.owner.retryOverrides(); assert.equal(run.state.overrides.error, null); }
  }
});

test('event-search replacement preserves queued overrides and closing their request drains remaining siblings', async t => {
  const old = deferred(), value = deferred(), all = overrideMetadata(); all.capabilities.events = true;
  const run = setup(t, (resource, options) => resource.endsWith('/events') && options.params.q === 'old' ? old.promise
    : options.params?.section === 'overrides' ? value.promise : Promise.resolve(response(resource, options)), { metadata: all });
  await run.owner.load(); await run.owner.toggleEvents(); const searching = run.owner.applyEvents({ q: 'old' });
  await run.owner.toggleOverrides(); const replacing = run.owner.applyEvents({ q: 'new' }); await flush();
  assert.equal(run.calls.at(-1).params.section, 'overrides'); await run.owner.toggleParameters(); await run.owner.toggleChildren();
  await run.owner.toggleOverrides(); await flush();
  value.reject(new ApiError('http', { status: 404 })); old.reject(new ApiError('http', { status: 403 })); await Promise.all([searching,replacing]);
  assert.equal(run.state.overrides.open, false); assert.ok(run.state.parameters.page); assert.ok(run.state.children.page);
  assert.equal(run.state.phase, 'ready');
});

test('override deadline, A-to-B-to-A generations and disposal suppress late values and never start overlapping polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending = [], run = setup(t, (resource, options) => {
    if (options.params?.section !== 'overrides') return Promise.resolve(response(resource, options));
    const wait = deferred(); pending.push({ ...wait, signal: options.signal }); return wait.promise;
  }, { timeoutMs: 20, autoRefresh: true, pollIntervalMs: 100 });
  await run.owner.load(); const first = run.owner.toggleOverrides(); await flush();
  const b = run.owner.select('18'); await flush(); const a = run.owner.select('17'); await flush();
  pending[0].reject(new ApiError('http', { status: 404 })); pending[1].resolve(overridePage([overrideRow('2')])); pending[2].resolve(overridePage([overrideRow('3')]));
  await Promise.all([first,b,a]); assert.equal(run.state.overrides.page.data[0].property_id, '3');
  const late = run.owner.refresh(); await flush(); const count = run.calls.length; t.mock.timers.tick(1000); await run.owner.refresh();
  assert.equal(run.calls.length, count); assert.equal(pending[3].signal.aborted, true);
  pending[3].reject(new Error('aborted')); await late; assert.equal(run.state.overrides.error.kind, 'timeout');
  const disposed = run.owner.retryOverrides(); await flush(); const published = run.state;
  run.owner.dispose(); pending[4].resolve(overridePage()); await disposed; assert.equal(run.state, published);
  assert.equal(run.owner.checkpointOverrides().open, false);
});

test('override UI shows only property, value and sensitivity with exact path expansion and distinct value states', async t => {
  const path = '<b>path 影狼</b>\\Properties[ConnectionString]\r\n '.repeat(60);
  const rows = [overrideRow('1', { property_path: path, value: '<b>literal</b>\r\n尾 '.repeat(20) }),
    overrideRow('2', { value: null }), overrideRow('3', { value: '' }),
    overrideRow('4', { sensitive: true, redacted: true, redaction_reason: 'sensitive', value: null }),
    overrideRow('5', { redacted: true, redaction_reason: 'policy', value: null }), overrideRow('6', { value: '😀'.repeat(16384), truncated: true })];
  const dom = screen(t, async (resource, options) => options.params?.section === 'overrides' ? overridePage(rows) : response(resource, options));
  await flush(); assert.equal(dom.get('overrides-panel').hidden, true); click(dom, 'overrides-toggle'); await flush();
  const first = dom.overrideBody.children[0]; assert.equal(first.children.length, 3);
  assert.equal(first.children[0].children[0].textContent, [...path].slice(0,160).join('') + '…');
  assert.equal(first.children[0].children[2].children[1].textContent, path);
  assert.equal(first.children[1].children[2].children[1].textContent, rows[0].value);
  for (const value of ['NULL (unredacted)', '(empty)', 'Redacted (sensitive)', 'Redacted (policy)', 'Truncated to 16384 characters.']) assert.ok(dom.overrideBody.textContent.includes(value));
  assert.equal(dom.get('overrides-policy').hidden, true);
  for (const index of [1,2,3,4]) assert.equal(dom.overrideBody.children[index].children[1].children[2].hidden, true);
});

test('policy-hidden values keep paths available while redaction clears old expanded text without losing path focus or scroll', async t => {
  let redacted = false;
  const dom = screen(t, async (resource, options) => options.params?.section === 'overrides' ? overridePage([overrideRow('1', redacted
    ? { redacted: true, redaction_reason: 'policy', value: null } : { value: 'private-override-canary '.repeat(20) })]) : response(resource, options));
  await flush(); click(dom, 'overrides-toggle'); await flush(); const row = dom.overrideBody.children[0], path = row.children[0].children[2], value = row.children[1].children[2];
  path.open = value.open = true; dom.get('overrides-scroll').scrollLeft = 120; dom.get('overrides-scroll').scrollTop = 75;
  redacted = true; click(dom, 'detail-refresh'); value.children[0].focus(); await flush();
  assert.equal(dom.overrideBody.children[0], row); assert.equal(path.open, true); assert.equal(value.open, false);
  assert.doesNotMatch(row.textContent, /private-override-canary/); assert.equal(value.children[1].textContent, '');
  assert.equal(dom.document.activeElement, dom.get('overrides-scroll')); assert.equal(dom.get('overrides-scroll').scrollLeft, 120);
  path.children[0].focus(); click(dom, 'detail-refresh'); await flush(); assert.equal(dom.document.activeElement, path.children[0]);
});

test('override checkpoints contain IDs and cursors only; metadata policy is revalidated before restoring paths and values', async t => {
  const dom = screen(t, async (resource, options) => options.params?.section === 'overrides' ? overridePage([overrideRow('1',
    { property_path: 'private-path-canary', value: 'private-value-canary '.repeat(20) })]) : response(resource, options));
  await flush(); click(dom, 'overrides-toggle'); await flush(); const row = dom.overrideBody.children[0];
  row.children[0].children[2].open = row.children[1].children[2].open = true; row.children[1].children[2].children[0].focus();
  const checkpoint = dom.mounted.checkpoint(); assert.doesNotMatch(JSON.stringify(checkpoint), /private-path-canary|private-value-canary|property_path|redaction_reason/);
  dom.mounted.dispose(); const blocked = screen(t, undefined, { metadata: overrideMetadata(false), restoreView: checkpoint }); await flush();
  assert.equal(blocked.calls.length, 1); assert.equal(blocked.get('overrides-toggle').disabled, true);
  const policy = screen(t, async (resource, options) => options.params?.section === 'overrides' ? overridePage([overrideRow('1',
    { redacted: true, redaction_reason: 'policy', value: null })]) : response(resource, options), { metadata: overrideMetadata(true,false), restoreView: checkpoint });
  await flush(); assert.equal(policy.get('overrides-policy').hidden, false); assert.equal(policy.get('overrides-toggle').disabled, false);
  assert.equal(policy.overrideBody.children[0].children[0].children[2].open, true);
  assert.equal(policy.overrideBody.children[0].children[1].children[2].open, false); assert.equal(policy.document.activeElement, policy.get('overrides-scroll'));
  const enabled = screen(t, undefined, { restoreView: policy.mounted.checkpoint() }); await flush();
  assert.equal(enabled.get('overrides-policy').hidden, true); assert.ok(enabled.overrideBody.textContent.includes('1.2300'));
});

test('policy violations clear previous override DOM text and invalid sizes/busy controls cannot change the applied page', async t => {
  let mode = 'valid'; const wait = deferred();
  const dom = screen(t, (resource, options) => {
    if (options.params?.section !== 'overrides') return Promise.resolve(response(resource, options));
    return mode === 'slow' ? wait.promise : Promise.resolve(overridePage([overrideRow('1', mode === 'invalid' ? { sensitive: true, value: 'forbidden-override-canary' } : {})]));
  });
  await flush(); click(dom, 'overrides-toggle'); await flush(); dom.get('overrides-limit').value = '201'; dom.get('overrides-limit').dispatchEvent(new Event('change'));
  assert.match(dom.get('overrides-notice').textContent, /between 1 and 200/);
  mode = 'slow'; click(dom, 'detail-refresh'); await flush(); const count = dom.calls.length; click(dom, 'detail-refresh');
  dom.get('overrides-limit').value = '8'; dom.get('overrides-limit').dispatchEvent(new Event('change')); assert.equal(dom.get('overrides-limit').value, '50');
  assert.equal(dom.calls.length, count); dom.get('legacy-detail-link').focus(); wait.resolve(overridePage()); await flush(); assert.equal(dom.document.activeElement, dom.get('legacy-detail-link'));
  mode = 'invalid'; click(dom, 'detail-refresh'); await flush(); assert.doesNotMatch(dom.overrideBody.textContent, /1\.2300|forbidden-override-canary/);
  assert.equal(dom.field('package').textContent, 'Main.dtsx'); dom.mounted.dispose(); const closed = dom.calls.length;
  click(dom, 'overrides-toggle'); assert.equal(dom.calls.length, closed); assert.equal(dom.overrideBody.textContent, '');
});
