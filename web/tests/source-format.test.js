import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('authored JavaScript lines stay within 140 characters', () => {
  const root = new URL('../src/', import.meta.url);
  const files = readdirSync(root).filter(name => name.endsWith('.js'));
  assert.ok(files.length > 0);
  const long = files.flatMap(name => readFileSync(new URL(name, root), 'utf8').split(/\r?\n/)
    .flatMap((line, index) => line.length > 140 ? [`${name}:${index + 1}: ${line.length} characters`] : []));
  assert.deepEqual(long, [], long.join('\n'));
});
