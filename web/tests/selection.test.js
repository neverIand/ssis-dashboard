import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogName, createSelectionSession, defaultSelection, parseSelection,
  SelectionError, selectionParams, selectionSearch, timestampTicks, validateSelection } from '../src/selection.js';
import { metadata } from './fixtures.js';

const settings = metadata();
settings.execution_statuses.push({ code: 7, name: 'succeeded' });

test('all scopes are omitted while literal exact names survive URL round trips', () => {
  const defaults = parseSelection('', settings);
  assert.deepEqual(defaults, defaultSelection(settings));
  assert.equal(selectionSearch(defaults, settings), '');
  for (const name of ['all', '*', '%_[', 'O\'Brien/+#\\東京', '  Name  ', '😀'.repeat(64), '%2F+', '<b>影狼</b>']) {
    const value = validateSelection({ ...defaults, folder: name, project: name }, settings);
    const search = selectionSearch(value, settings);
    assert.deepEqual(parseSelection(search, settings), value);
    assert.equal(selectionParams(value).folder, name);
    assert.equal(new URLSearchParams(search).get('project'), name);
    assert.equal(search.includes('cursor'), false);
  }
  assert.equal(selectionParams(defaults).folder, null);
  assert.equal(selectionParams(defaults).project, null);
  assert.equal(selectionParams(defaults).status, null);
  assert.equal(parseSelection('?project=all', settings).project, 'all');
});

test('strict URLs reject unknown, duplicate, malformed, empty and transient parameters', () => {
  for (const search of ['?cursor=opaque', '?page=2', '?folder=a&folder=b', '?folder=', '?limit',
    '?folder=%', '?folder=%FF', '?folder=%ED%A0%80', '?folder=%00', '?folder=a&&project=b',
    '?status=all', '?status=2,2', '?status=02', '?status=2,', '?status=0', '?status=9',
    '?sort=unknown', '?direction=ASC', '?limit=0', '?limit=201', '?limit=-1', '?limit=1e2',
    '?limit=%D9%A1', '?from=2026-10-17T00:00:00']) {
    assert.throws(() => parseSelection(search, settings), SelectionError, search);
  }
  assert.equal(parseSelection('?folder=%252F%2B', settings).folder, '%2F+');
});

test('names respect UTF-16 widths without trimming or accepting lone surrogates', () => {
  assert.equal(catalogName(' '), ' ');
  assert.equal(catalogName('😀'.repeat(64)).length, 128);
  for (const name of ['', 'a'.repeat(129), '😀'.repeat(65), '\ud800', '\udc00', 'x\0y', null]) {
    assert.throws(() => catalogName(name), SelectionError);
  }
});

test('selection restores advertised status sets, sort, direction and bounded size', () => {
  const value = parseSelection('?status=7,2&sort=created_at&direction=asc&limit=25', settings);
  assert.deepEqual(value.status, [2, 7]);
  assert.equal(value.sort, 'created_at');
  assert.equal(value.direction, 'asc');
  assert.equal(value.limit, 25);
  assert.equal(new URLSearchParams(selectionSearch(value, settings)).get('status'), '2,7');
  assert.deepEqual(parseSelection(selectionSearch(value, settings), settings), value);
});

test('timestamp validation compares exact ticks with explicit offsets and calendar boundaries', () => {
  assert.equal(timestampTicks('0001-01-01T00:00:00Z'), 0n);
  assert.equal(timestampTicks('2026-10-25T01:30:00.1234567+01:00'), timestampTicks('2026-10-25T00:30:00.1234567Z'));
  assert.equal(timestampTicks('2026-10-17T00:00:00.0000001Z') - timestampTicks('2026-10-17T00:00:00Z'), 1n);
  assert.equal(timestampTicks('2024-02-29T00:00:00Z') - timestampTicks('2024-02-28T00:00:00Z'), 864000000000n);
  assert.equal(timestampTicks('2000-02-29T00:00:00+14:00') + 504000000000n, timestampTicks('2000-02-29T00:00:00Z'));
  for (const value of ['0000-01-01T00:00:00Z', '1900-02-29T00:00:00Z', '2026-02-30T00:00:00Z',
    '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-17T24:00:00Z',
    '2026-10-17T00:60:00Z', '2026-10-17T00:00:60Z', '2026-10-17T00:00:00-00:00',
    '2026-10-17T00:00:00+14:01', '2026-10-17T00:00:00+00:60', '2026-10-17T00:00:00.12345678Z',
    '2026-10-17t00:00:00z', '0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01']) {
    assert.throws(() => timestampTicks(value), SelectionError, value);
  }
});

test('custom and server-returned bounds retain seven digits and never pass through Date', () => {
  const from = '2026-10-17T01:00:00.0000001+01:00';
  const to = '2026-10-17T00:00:00.0000002Z';
  const value = validateSelection({ ...defaultSelection(settings), from, to }, settings);
  assert.equal(value.from, from);
  assert.equal(selectionParams(value).to, to);
  assert.deepEqual(parseSelection(selectionSearch(value, settings), settings), value);
  for (const bounds of [{ from: to, to: from }, { from, to: from },
    { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00.0000001Z' }]) {
    assert.throws(() => validateSelection({ ...value, ...bounds }, settings), SelectionError);
  }
  const maximum = validateSelection({ ...value, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }, settings);
  assert.equal(maximum.to, '2026-02-01T00:00:00Z');
  assert.equal(parseSelection('?to=2026-10-17T00%3A00%3A00Z', settings).from, null);
});

test('draft changes leave applied filters intact and a folder change clears the old project', () => {
  const session = createSelectionSession(settings);
  const initial = session.restore('?folder=First&project=Shared&status=7&sort=created_at&limit=25');
  session.update({ folder: 'Second' });
  assert.equal(session.draft.project, null);
  assert.equal(session.applied, initial);
  assert.equal(session.applied.project, 'Shared');
  session.update({ project: 'all', status: [2] });
  const applied = session.apply();
  assert.equal(applied.folder, 'Second');
  assert.equal(applied.sort, 'created_at');
  assert.equal(applied.limit, 25);
  assert.deepEqual(applied.status, [2]);
  assert.throws(() => applied.status.push(7), TypeError);
  const copy = session.draft;
  copy.status.push(7);
  assert.deepEqual(session.draft.status, [2]);
  session.update({ from: 'bad' });
  assert.throws(() => session.apply(), SelectionError);
  assert.equal(session.applied, applied);
});

test('history restoration replaces draft and applied state; invalid URLs have no applied defaults', () => {
  const session = createSelectionSession(settings);
  session.restore('?folder=First');
  session.update({ folder: 'Unapplied' });
  const second = session.restore('?folder=Second&status=2');
  assert.equal(session.draft.folder, 'Second');
  assert.equal(session.applied, second);
  session.restore('?folder=First');
  assert.equal(session.applied.folder, 'First');
  assert.throws(() => session.restore('?status=bad'), SelectionError);
  assert.equal(session.applied, null);
  session.restore('');
  assert.deepEqual(session.applied, defaultSelection(settings));
});
