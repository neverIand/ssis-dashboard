import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const templates = new URL('../../dashboard/templates/app/', import.meta.url);
const readTemplate = name => readFileSync(new URL(name, templates), 'utf8');
const overview = readTemplate('index.html'), historyPanel = readTemplate('history-panel.html');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('G2: the selection rule applies to buttons and leaves text inputs, links, cells and status text selectable', () => {
  const nonSelectable = [...css.matchAll(/([^{}]+)\{[^{}]*\buser-select:\s*none\b[^{}]*\}/g)];
  assert.deepEqual(nonSelectable.map(rule => rule[1].trim()), ['button']);
});

test('G3: auto popovers have headings without close buttons and keep their named actions', () => {
  for (const file of readdirSync(templates).filter(name => name.endsWith('.html'))) {
    const html = readTemplate(file);
    const autoPopovers = html.match(/\bpopover="auto"/g) ?? [];
    const headings = [...html.matchAll(/popover="auto"[^>]*>\s*<div class="popover-heading">([^]*?)<\/div>/g)];
    assert.equal(headings.length, autoPopovers.length, file);
    for (const [, heading] of headings) assert.match(heading, /^<h2\b[^>]*>[^<]+<\/h2>$/);
    assert.doesNotMatch(html, /data-(?:close-filter|history-close)|aria-label="Close [^"]*picker"/);
  }
  assert.match(overview, /data-status-done popovertarget="status-picker" popovertargetaction="hide">Done<\/button>/);
  assert.match(overview, /data-cancel-range popovertarget="created-picker" popovertargetaction="hide">Cancel<\/button>/);
  assert.match(overview, /data-use-range>Use range<\/button>/);
  assert.match(historyPanel, /<button type="submit" data-history-apply>Done<\/button>/);
});

test('G4: picker fields have native clear buttons and only folder and project retain an All choice', () => {
  assert.match(overview, /\{% for kind in \['folder', 'project'\] %\}/);
  assert.match(overview, /data-all-scope="\{\{ kind \}\}">All \{\{ kind \}\}s<\/button>/);
  assert.doesNotMatch(overview, /data-all-scope="package"/);
  for (const label of ['Clear search', 'Clear package name']) {
    const field = new RegExp(`<div class="picker-field">\\s*<input[^>]+>\\s*` +
      `<button type="button" data-clear-picker="[^"]+" aria-label="${label}" hidden>[^<]+</button>\\s*</div>`);
    assert.match(overview, field);
  }
});
