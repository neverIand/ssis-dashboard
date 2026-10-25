import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { renderChartAxes } from '../src/chart-view.js';
import { Node } from './overview-dom.js';

test('native authored sources avoid inline style attributes, HTML sinks and dynamic execution', async () => {
  const root = new URL('../src/', import.meta.url);
  const banned = /\bsetAttribute\s*\(\s*(['"])style\1|\b(?:innerHTML|insertAdjacentHTML|outerHTML)\b|\bdocument\s*\.\s*write\s*\(|\beval\s*\(|\bnew\s+Function\b/i;
  const files = (await readdir(root, { recursive: true })).filter(name => /\.(?:js|css)$/.test(name));
  assert.ok(files.length > 0);
  for (const filename of files) assert.doesNotMatch(await readFile(new URL(filename.replaceAll('\\', '/'), root), 'utf8'), banned, filename);
});

test('chart axes position distinct ticks through CSSOM, including the zero scale', () => {
  const document = { createElement: tag => new Node(document, tag) };
  const xAxis = new Node(document, 'div'), yAxis = new Node(document, 'div');
  for (const maximum of [10, 0]) {
    renderChartAxes(xAxis, yAxis, [{ text: 'Start', title: 'Full start' }], maximum, String);
    const values = maximum ? [10, 5, 0] : [0];
    assert.deepEqual(yAxis.children.map(node => node.textContent), values.map(String));
    assert.deepEqual(yAxis.children.map(node => Math.round(parseFloat(node.style.top))), maximum ? [6, 50, 94] : [94]);
    for (const node of yAxis.children) assert.ok(node.style.top.endsWith('%'));
    for (const node of yAxis.children) assert.equal(node.getAttribute('style'), null);
    assert.equal(yAxis.getAttribute('data-zero'), String(maximum === 0));
  }
});
