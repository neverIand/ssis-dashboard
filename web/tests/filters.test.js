import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFilters } from '../src/filters.js';
import { deferred, envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';

const settings = metadata(), folder = 'Fold\r\ner', project = 'Pro\nject';
const search = (folder, project) => '?' + new URLSearchParams({ folder, project });
const settled = () => new Promise(resolve => setImmediate(resolve));
function setup(t, query = '') {
  const dom = filtersDOM(settings, query), calls = [], applied = [];
  const dispose = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    onApplied: selection => applied.push(selection), api: { get: async (kind, { params }) => {
      calls.push({ kind, ...params });
      if (kind === 'meta') return envelope();
      const data = kind === 'folders' ? [{ folder_id: '1', name: folder, description: null }]
        : [{ project_id: '2', folder_id: '1', folder_name: params.folder, name: project, description: null }];
      return { ...envelope(data), meta: { ...envelope().meta, from: null, to: null, limit: params.limit,
        sort: 'name', direction: 'asc', has_more: false, next_cursor: null } };
    } } });
  t.after(dispose);
  return { ...dom, calls, applied };
}

for (const newline of ['\r', '\n', '\r\n']) test(`exact URL names with ${JSON.stringify(newline)} survive browsing and unchanged Apply`, async t => {
  const exactFolder = `Fold${newline}er`, exactProject = `Pro${newline}ject`;
  const dom = setup(t, search(exactFolder, exactProject));
  assert.equal(dom.calls.length, 0, 'Catalog requests are on demand');
  assert.equal(dom.get('[data-filter-label="folder"]').textContent, exactFolder);
  dom.open('project'); await settled();
  assert.equal(dom.calls[0].folder, exactFolder);
  dom.close(); dom.submit();
  assert.equal(dom.applied.at(-1).folder, exactFolder);
  assert.equal(dom.applied.at(-1).project, exactProject);
  assert.equal(dom.window.location.searchParams.get('folder'), exactFolder);
});

test('scope applies immediately, clears dependent project, and preserves pending statuses and time', async t => {
  const dom = setup(t, search('Old', project));
  const status = dom.get('#status'); status.children[1].checked = true; status.dispatchEvent(new Event('change'));
  dom.open('created'); dom.edit('#creation-window', 'custom', 'change');
  dom.edit('#from', '2026-10-17T00:00:00.0000001Z'); dom.click('[data-use-range]');
  dom.open('folder'); await settled();
  dom.get('[data-catalog-choices="folder"]').children[0].click();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, null);
  assert.deepEqual(dom.applied.at(-1).status, []);
  assert.equal(dom.applied.at(-1).from, null);
  const direction = dom.root.querySelector('[data-order="direction"]'); direction.value = 'asc'; direction.dispatchEvent(new Event('change'));
  dom.submit();
  assert.deepEqual(dom.applied.at(-1).status, [1]);
  assert.equal(dom.applied.at(-1).from, '2026-10-17T00:00:00.0000001Z');
  assert.equal(dom.applied.at(-1).direction, 'asc');
});

test('canonical selected names, same-folder reselection and Reset keep scope', async t => {
  const dom = setup(t);
  dom.open('folder'); await settled(); dom.get('[data-catalog-choices="folder"]').children[0].click();
  dom.open('project'); await settled(); dom.get('[data-catalog-choices="project"]').children[0].click();
  dom.open('folder'); await settled(); dom.get('[data-catalog-choices="folder"]').children[0].click();
  assert.equal(dom.applied.at(-1).project, project);
  dom.click('[data-reset-filters]');
  assert.equal(dom.applied.at(-1).folder, folder); assert.equal(dom.applied.at(-1).project, project);
});

test('exact project name across all folders, URL history and invalid URL recovery', t => {
  const dom = setup(t);
  dom.open('project'); dom.edit('#project-search', ' Project '); dom.click('[data-exact-scope="project"]');
  assert.equal(dom.applied.at(-1).folder, null); assert.equal(dom.applied.at(-1).project, ' Project ');
  dom.restore(search(folder, project)); assert.equal(dom.applied.at(-1).project, project);
  dom.restore('?status=bad'); assert.equal(dom.applied.at(-1), null);
  assert.equal(dom.get('fieldset').disabled, true); assert.equal(dom.get('[data-recover-filters]').hidden, false);
  dom.click('[data-recover-filters]'); assert.equal(dom.get('fieldset').disabled, false);
  assert.equal(dom.applied.at(-1).folder, null); assert.equal(dom.window.location.search, '');
});

test('calendar dates become inclusive days in the configured zone; Cancel and exact values survive', t => {
  const dom = setup(t);
  dom.open('created'); dom.edit('#creation-window', 'custom', 'change');
  dom.edit('#from-date', '2026-10-24'); dom.edit('#to-date', '2026-10-25'); dom.click('[data-use-range]');
  assert.equal(dom.applied.at(-1).from, null, 'Range stays a draft until Apply');
  dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-23T23:00:00Z');
  assert.equal(dom.applied.at(-1).to, '2026-10-26T00:00:00Z');
  const exact = '?'+new URLSearchParams({ from: '2026-10-17T00:00:00.0000001+01:00', to: '2026-10-18T00:00:00.0000002+01:00' });
  dom.restore(exact); dom.open('created'); dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-17T00:00:00.0000001+01:00');
  assert.equal(dom.applied.at(-1).to, '2026-10-18T00:00:00.0000002+01:00');
  dom.open('created'); dom.edit('#from-date', '2026-01-01'); dom.close(); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-17T00:00:00.0000001+01:00');
});

test('DST duplicate time requires a choice and nonexistent time does not apply', t => {
  const dom = setup(t); dom.open('created'); dom.edit('#creation-window', 'custom', 'change');
  dom.get('#include-time').checked = true; dom.get('#include-time').dispatchEvent(new Event('change'));
  dom.edit('#from-date', '2026-10-25'); dom.edit('#from-time', '01:30'); dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /occurs twice/);
  assert.equal(dom.get('[data-occurrence-label="from"]').hidden, false);
  dom.edit('#from-occurrence', '1', 'change'); dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-25T01:30:00Z');
  dom.open('created'); dom.edit('#from-date', '2026-03-29'); dom.edit('#from-time', '01:30'); dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /skipped/);
});

test('relative presets resolve from server time and apply only after Use range and Apply', async t => {
  const dom = setup(t); dom.open('created'); dom.edit('#creation-window', '24h', 'change');
  dom.click('[data-use-range]'); await settled();
  assert.equal(dom.calls[0].kind, 'meta'); assert.equal(dom.applied.at(-1).from, null);
  dom.submit(); assert.equal(dom.applied.at(-1).from, '2026-10-16T16:00:00.1234567Z');
});

test('mixing calendar and exact edits preserves each bound independently, including clearing a date', t => {
  const dom = setup(t, '?' + new URLSearchParams({ from: '2026-10-17T00:00:00Z', to: '2026-10-18T00:00:00Z' }));
  dom.open('created');
  dom.edit('#from-date', '');
  dom.edit('#to', '2026-10-19T00:00:00.1234567+01:00');
  dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, null, 'An exact edit of the other bound must not restore a cleared date');
  assert.equal(dom.applied.at(-1).to, '2026-10-19T00:00:00.1234567+01:00');
});

test('an exact edit cannot hide an invalid calendar bound or an unresolved repeated time', t => {
  const dom = setup(t, '?' + new URLSearchParams({ from: '2026-10-24T00:00:00Z', to: '2026-10-26T00:00:00Z' }));
  dom.open('created');
  dom.edit('#from-date', '2026-10-25'); dom.edit('#from-time', '01:30');
  dom.edit('#to', '2026-10-27T00:00:00Z'); dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /occurs twice/);
  dom.edit('#from-occurrence', '1', 'change'); dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-25T01:30:00Z');
  assert.equal(dom.applied.at(-1).to, '2026-10-27T00:00:00Z');
});

test('invalid exact text on one bound remains invalid after editing the other calendar bound', t => {
  const dom = setup(t, '?' + new URLSearchParams({ from: '2026-10-17T00:00:00Z', to: '2026-10-18T00:00:00Z' }));
  dom.open('created'); dom.edit('#from', 'invalid'); dom.edit('#to-date', '2026-10-19');
  dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /valid RFC 3339/);
  assert.equal(dom.get('#from').value, 'invalid');
});

test('keyboard Load more follows new choices and respects focus moved during the request', async t => {
  const dom = filtersDOM(settings), second = deferred(), third = deferred();
  const page = (id, next) => ({ ...envelope([{ folder_id: id, name: `Folder ${id}`, description: null }]),
    meta: { ...envelope().meta, from: null, to: null, limit: settings.limits.default_limit,
      sort: 'name', direction: 'asc', has_more: next !== null, next_cursor: next } });
  let calls = 0;
  t.after(mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/', api: {
    get: () => [Promise.resolve(page('1', 'second')), second.promise, third.promise][calls++],
  } }));
  dom.open('folder'); await settled();
  const more = dom.get('[data-catalog-more="folder"]'), input = dom.get('#folder-search');
  more.focus(); more.click();
  assert.equal(more.getAttribute('aria-disabled'), 'true');
  assert.notEqual(more.disabled, true, 'Native disabling would blur the request control');
  input.focus(); second.resolve(page('2', 'third')); await settled();
  assert.equal(dom.document.activeElement, input);
  more.focus(); more.click(); third.resolve(page('3', null)); await settled();
  assert.equal(more.hidden, true);
  assert.equal(dom.document.activeElement.textContent, 'Folder 3');
});
