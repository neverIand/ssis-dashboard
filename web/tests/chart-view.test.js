import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderChartAxes } from '../src/chart-view.js';
import { Node } from './overview-dom.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('K1: chart roots are not Tab stops; their selected point is', () => {
  for (const [file, attribute] of [['index', 'data-timeline-chart'], ['history-panel', 'data-history-chart-plot']]) {
    assert.match(source(`../../dashboard/templates/app/${file}.html`), new RegExp(`<svg [^>]*${attribute}[^>]* tabindex="-1"`), file);
  }
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
