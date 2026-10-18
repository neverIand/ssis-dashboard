import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { executionHref, readOverviewReturn } from '../src/detail-navigation.js';
import { createOverview } from '../src/overview.js';
import { defaultSelection, parseSelection } from '../src/selection.js';
import { envelope, metadata, wireTime } from './fixtures.js';

const settings = metadata();
const options = { metadata: settings, appBase: '/ops/monitor/app/', origin: 'https://example.test' };
const selection = { ...defaultSelection(settings), folder: 'Fold\r\ner + / 影狼', project: 'Pro\nject',
  from: '2026-10-17T00:00:00.0000001Z', to: '2026-10-17T18:00:00.1234567Z', limit: 1 };

test('native detail URLs carry exact validated selection only and stay within the application prefix', () => {
  const href = executionHref('9223372036854775807', { ...selection, cursor: 'private-cursor', rows: ['private'] }, options);
  assert.ok(href.startsWith('/ops/monitor/app/executions/9223372036854775807?overview='));
  assert.doesNotMatch(href, /private|cursor|rows/);
  const returned = readOverviewReturn(new URL(href, options.origin).search, options);
  assert.deepEqual(returned.selection, selection);
  assert.deepEqual(parseSelection(new URL(returned.href, options.origin).search, settings), selection);
  assert.match(returned.notice, /page one/);
});

test('standalone or invalid return context has a safe default without accepting arbitrary destinations', () => {
  assert.deepEqual(readOverviewReturn('', options), { href: options.appBase, selection: null, notice: '' });
  for (const search of ['?return=https://outside.invalid', '?overview=https://outside.invalid',
    '?overview=//outside.invalid', '?overview=%253Ffolder%253Dencoded', '?overview=%3Fcursor%3Dtoken',
    '?overview=%3Ffolder%3Dx&overview=%3Ffolder%3Dy', '?overview=%3Fstatus%3D1%2C1',
    '?overview=%3Flimit%3D201', '?overview=%3Ffolder%3D%25ZZ', '?overview=%3Ffolder%3Dx&extra=y']) {
    const returned = readOverviewReturn(search, options);
    assert.equal(returned.href, options.appBase);
    assert.equal(returned.selection, null);
    assert.match(returned.notice, /invalid/);
  }
  assert.equal(executionHref('1', defaultSelection(settings), options), options.appBase + 'executions/1');
  const percent = executionHref('1', { ...selection, folder: '%ZZ' }, options);
  assert.equal(readOverviewReturn(new URL(percent, options.origin).search, options).selection.folder, '%ZZ');
  assert.throws(() => executionHref('01', selection, options));
  assert.throws(() => readOverviewReturn('', { ...options, appBase: '//outside.invalid/app/' }));
});

function overviewRun(retainedPaths = [], { expired = false } = {}) {
  const calls = [], states = [];
  const api = { async get(resource, { params }) {
    calls.push({ resource, params });
    if (resource === 'metrics/summary') return { ...envelope({ total: 2, by_status: [
      { code: 1, name: 'created', count: 0 }, { code: 2, name: 'running', count: 2 },
      { code: 4, name: 'failed', count: 0 }, { code: 7, name: 'succeeded', count: 0 }] }),
    meta: { ...envelope().meta, from: selection.from, to: selection.to, status_scope: 'all' } };
    if (params.cursor && expired) throw new ApiError('http', { status: 400, code: 'cursor_expired' });
    return { ...envelope([{ execution_id: params.cursor ? '8' : '9', folder_name: selection.folder,
      project_name: selection.project, package_name: 'Probe.dtsx', status: { code: 2, name: 'running' },
      created_at: wireTime, started_at: null, ended_at: null, duration_seconds: null,
      elapsed_seconds: null, warning_count: 0, error_count: 0 }]),
    meta: { ...envelope().meta, from: selection.from, to: selection.to, as_of: wireTime, upper_id: '9',
      consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 1,
      has_more: !params.cursor, next_cursor: params.cursor ? null : 'retained-entry' } };
  } };
  const owner = createOverview({ api, metadata: settings, retainedPaths, autoRefresh: false,
    publish: state => states.push(state) });
  return { owner, calls, get state() { return states.at(-1); } };
}

test('selection return re-fetches a retained page path while a fresh document starts at page one', async () => {
  const href = executionHref('9', selection, options);
  const returned = readOverviewReturn(new URL(href, options.origin).search, options).selection;
  const original = overviewRun();
  await original.owner.apply(selection);
  await original.owner.next();
  const paths = original.owner.checkpoint();
  original.owner.dispose();
  for (const retain of [true, false]) {
    const restored = overviewRun(retain ? paths : []);
    await restored.owner.apply(returned, { restore: true });
    assert.equal(restored.state.pageNumber, retain ? 2 : 1);
    assert.equal(restored.calls[0].params.cursor, retain ? 'retained-entry' : undefined);
    assert.equal(restored.calls.at(-1).resource, 'metrics/summary');
    restored.owner.dispose();
  }
});

test('an expired retained return path resets once with an explanation', async () => {
  const original = overviewRun();
  await original.owner.apply(selection);
  await original.owner.next();
  const paths = original.owner.checkpoint();
  original.owner.dispose();
  const returned = overviewRun(paths, { expired: true });
  await returned.owner.apply(selection, { restore: true });
  assert.equal(returned.state.pageNumber, 1);
  assert.equal(returned.calls.filter(call => call.resource === 'executions').length, 2);
  assert.match(returned.state.notice, /expired/i);
  returned.owner.dispose();
});
