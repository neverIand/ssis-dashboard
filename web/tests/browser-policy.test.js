import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('native authored sources avoid inline style attributes, HTML sinks and dynamic execution', async () => {
  const root = new URL('../src/', import.meta.url);
  const banned = /\bsetAttribute\s*\(\s*(['"])style\1|\b(?:innerHTML|insertAdjacentHTML|outerHTML)\b|\bdocument\s*\.\s*write\s*\(|\beval\s*\(|\bnew\s+Function\b/i;
  const files = (await readdir(root, { recursive: true })).filter(name => /\.(?:js|css)$/.test(name));
  assert.ok(files.length > 0);
  for (const filename of files) assert.doesNotMatch(await readFile(new URL(filename.replaceAll('\\', '/'), root), 'utf8'), banned, filename);
});
