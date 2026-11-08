import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDisplay } from '../src/display.js';
import { readExecutionPage } from '../src/overview.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { envelope, metadata, wireTime } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';

const settings = metadata();
const display = createDisplay({ timeZone: settings.display_timezone, locale: 'en-GB' });
const from = '2026-10-17T00:00:00.0000001Z', to = '2026-10-17T18:00:00.1234567Z';
// wireTime is 2026-10-17T16:00:00Z; a 25-minute typical run ends 16:25.
const estimate = (changes = {}) => ({ method: 'mean_last_5_successful', sample_count: 5, duration_seconds: 1500,
  ended_at: '2026-10-17T16:25:00.0000000Z', ...changes });
const item = (id, changes = {}) => ({ execution_id: id, folder_name: 'Folder', project_name: 'Project',
  package_name: 'Probe.dtsx', status: { code: 2, name: 'running' }, created_at: wireTime, started_at: wireTime,
  ended_at: null, duration_seconds: null, elapsed_seconds: 600, estimate: estimate(), warning_count: 0, error_count: 0,
  ...changes });
const page = rows => ({ ...envelope(rows), meta: { ...envelope().meta, from, to, as_of: wireTime,
  upper_id: '99', consistency: 'live', sort: 'execution_id', direction: 'desc', limit: 50,
  has_more: false, next_cursor: null } });
const summary = () => ({ ...envelope({ total: 3, by_status: [{ code: 2, name: 'running', count: 3 }] }),
  meta: { ...envelope().meta, from, to, status_scope: 'all' } });
const selection = validateSelection(defaultSelection(settings), settings);
const nb = text => text.split(' · ').map(part => part.replaceAll(' ', '\u00a0')).join(' · ');

test('C4: list rows accept a null or valid active estimate and reject missing, ended or malformed ones', () => {
  const ok = page([item('3'), item('2', { estimate: null }),
    item('1', { status: { code: 7, name: 'succeeded' }, ended_at: wireTime, duration_seconds: 0, estimate: null })]);
  assert.equal(readExecutionPage(ok, selection, settings, display), ok);
  const missing = item('1'); delete missing.estimate;
  const cases = [missing, item('1', { status: { code: 7, name: 'succeeded' }, ended_at: wireTime, duration_seconds: 0 }),
    item('1', { started_at: null, elapsed_seconds: null }),
    ...[{ method: 'mean' }, { sample_count: 0 }, { sample_count: 6 }, { duration_seconds: 0 },
      { ended_at: '2026-10-17T15:59:59.9999999Z' }].map(changes => item('1', { estimate: estimate(changes) }))];
  for (const row of cases) {
    assert.throws(() => readExecutionPage(page([row]), selection, settings, display),
      error => error instanceof ApiError && error.kind === 'invalid_response', JSON.stringify(row.estimate));
  }
});

test('C4: running rows compare elapsed with the typical duration, flag an overrun and never show a percentage', async t => {
  const dom = overviewDOM();
  let rows = [item('3'), item('2', { elapsed_seconds: 1800 }), item('1', { estimate: null })];
  const view = mountOverview(dom.root, { metadata: settings, appBase: '/app/',
    api: { get: async resource => resource === 'executions' ? page(rows) : summary() } });
  t.after(() => view.dispose());
  await view.apply(defaultSelection(settings));
  const detail = index => dom.body.children[index].children[6].children.at(-1);
  assert.equal(detail(0).textContent, nb('Elapsed: 10 min 00 s · typical 25 min 00 s'));
  assert.equal(detail(0).dataset.estimate, 'within');
  assert.equal(detail(0).title, 'Typical: mean of 5 earlier successful runs · expected end 2026-10-17 17:25:00');
  assert.equal(detail(1).dataset.estimate, 'over');
  assert.equal(detail(2).textContent, nb('Elapsed: 10 min 00 s'));
  assert.equal(detail(2).dataset.estimate, undefined);
  for (const index of [0, 1, 2]) assert.doesNotMatch(dom.body.children[index].children[6].textContent, /%/);
  // A refresh that changes only the estimate redraws the cell; an ended row shows its duration without a comparison.
  rows = [item('3', { estimate: estimate({ duration_seconds: 300 }) }), item('2', { status: { code: 7, name: 'succeeded' },
    ended_at: wireTime, duration_seconds: 1800, elapsed_seconds: 1800, estimate: null }), item('1', { estimate: null })];
  await view.apply(defaultSelection(settings), { restore: true });
  assert.equal(detail(0).textContent, nb('Elapsed: 10 min 00 s · typical 5 min 00 s'));
  assert.equal(detail(0).dataset.estimate, 'over');
  assert.equal(dom.body.children[1].children[6].textContent, '30 min 00 s');
});
