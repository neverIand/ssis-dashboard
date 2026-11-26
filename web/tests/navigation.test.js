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

test('package rows allow 260-unit names and carry valid project and folder identities', () => {
  const pkg = (changes = {}) => ({ package_id: '3', name: 'p'.repeat(260), description: null, project_id: '2',
    project_name: 'Load', folder_id: '1', folder_name: 'Finance', ...changes });
  assert.equal(readNavigation(page([pkg()]), 'packages', 2)[0].name.length, 260);
  for (const changes of [{ name: 'p'.repeat(261) }, { project_id: null }, { project_name: '' }, { folder_id: 1 },
    { folder_name: 'x'.repeat(129) }, { package_id: '01' }]) {
    assert.throws(() => readNavigation(page([pkg(changes)]), 'packages', 2), (error) => error.kind === 'invalid_response',
      JSON.stringify(changes));
  }
});
