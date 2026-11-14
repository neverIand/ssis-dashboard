import assert from 'node:assert/strict';
import test from 'node:test';
import { readNavigation } from '../src/navigation.js';
import { envelope } from './fixtures.js';

const folder = (id, name) => ({ folder_id: id, name, description: null });
const project = (id, name, parent = 'Exact + / 影狼') => ({ project_id: id, name, description: '',
  folder_id: '9007199254740993', folder_name: parent });
function page(rows, next = null, limit = 2) {
  return { ...envelope(rows), meta: { ...envelope().meta, limit, sort: 'name', direction: 'asc',
    from: null, to: null, has_more: next !== null, next_cursor: next } };
}

test('navigation validates identities and page metadata without rewriting exact names', () => {
  const rows = [folder('9007199254740993', '<b>影狼 + /</b>'), folder('9223372036854775807', 'all')];
  assert.equal(readNavigation(page(rows), 'folders', 2), rows);
  assert.equal(readNavigation(page([project('1', '  Exact  ')]), 'projects', 2)[0].name, '  Exact  ');
  for (const response of [page([folder(null, 'Null')]), page([folder(42, 'Numeric')]),
    page([folder('1', 'Same'), folder('1', 'Same')]), page([folder('1', 'x'.repeat(129))]),
    page([folder('1', 'OK')], ''), page([], 'cursor'), page([], null, 3),
    { ...page([]), meta: { ...page([]).meta, has_more: true, next_cursor: null } }]) {
    assert.throws(() => readNavigation(response, 'folders', 2), (error) => error.kind === 'invalid_response');
  }
});
