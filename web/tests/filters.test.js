import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFilters } from '../src/filters.js';
import { envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';

const settings = metadata();
const folder = 'Fold\r\ner', project = 'Pro\nject';
const search = (folder, project) => '?' + new URLSearchParams({ folder, project });
const settled = () => new Promise(resolve => setImmediate(resolve));

function setup(t, query = '') {
  const dom = filtersDOM(settings, query), calls = [], applied = [];
  const dispose = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    onApplied: selection => applied.push(selection), api: { get: async (kind, { params }) => {
      calls.push({ kind, ...params });
      const data = kind === 'folders' ? [{ folder_id: '1', name: folder, description: null }]
        : [{ project_id: '2', folder_id: '1', folder_name: params.folder, name: project, description: null }];
      return { ...envelope(data), meta: { ...envelope().meta, from: null, to: null, limit: params.limit,
        sort: 'name', direction: 'asc', has_more: false, next_cursor: null } };
    } } });
  t.after(dispose);
  return { ...dom, calls, applied };
}

for (const newline of ['\r', '\n', '\r\n']) {
  test(`URL names with ${JSON.stringify(newline)} survive project browsing, blur and unchanged Apply`, async t => {
    const exactFolder = `Fold${newline}er`, exactProject = `Pro${newline}ject`;
    const dom = setup(t, search(exactFolder, exactProject));
    await settled();
    assert.equal(dom.get('#folder').value, 'Folder', 'Model the actual single-line input sanitization');
    assert.equal(dom.get('#project').value, 'Project');
    assert.equal(dom.calls.find(call => call.kind === 'projects').folder, exactFolder);
    dom.get('#folder').dispatchEvent(new Event('blur'));
    dom.submit();
    assert.equal(dom.applied.at(-1).folder, exactFolder);
    assert.equal(dom.applied.at(-1).project, exactProject);
    assert.equal(dom.window.location.searchParams.get('folder'), exactFolder);
    assert.equal(dom.window.location.searchParams.get('project'), exactProject);
    assert.equal(dom.calls.filter(call => call.kind === 'projects').length, 1);
  });
}

test('status/time edits and table ordering retain canonical names and independent drafts', async t => {
  const dom = setup(t, search(folder, project));
  await settled();
  const status = dom.get('#status');
  status.children[0].checked = false;
  status.children[1].checked = true;
  status.dispatchEvent(new Event('change'));
  dom.edit('#creation-window', 'custom', 'change');
  dom.edit('#from', '2026-10-17T00:00:00.0000001Z');
  const direction = dom.root.querySelector('[data-order="direction"]');
  direction.value = 'asc';
  direction.dispatchEvent(new Event('change'));
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, project);
  assert.deepEqual(dom.applied.at(-1).status, []);
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, project);
  assert.deepEqual(dom.applied.at(-1).status, [1]);
  assert.equal(dom.applied.at(-1).from, '2026-10-17T00:00:00.0000001Z');
  assert.equal(dom.applied.at(-1).direction, 'asc');
});

test('choosing canonical names bypasses input sanitization and selecting the same folder retains its project', async t => {
  const dom = setup(t);
  await settled();
  dom.edit('#folder-options', folder, 'change');
  await settled();
  assert.equal(dom.calls.find(call => call.kind === 'projects').folder, folder);
  dom.edit('#project-options', project, 'change');
  dom.edit('#folder-options', folder, 'change');
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, project);
  assert.equal(dom.get('#folder-options').value, folder);
  assert.equal(dom.get('#project-options').value, project);
});

test('an explicit name edit takes effect even if its displayed text is unchanged; restore and reset replace that draft', async t => {
  const dom = setup(t, search(folder, project));
  await settled();
  dom.edit('#project', 'Project');
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, 'Project');
  dom.edit('#folder', 'Folder');
  assert.equal(dom.get('#project').value, '');
  dom.get('#folder').dispatchEvent(new Event('blur'));
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, 'Folder');
  assert.equal(dom.applied.at(-1).project, null);
  assert.equal(dom.calls.at(-1).folder, 'Folder');
  dom.restore(search(folder, project));
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, project);
  dom.get('[data-reset-filters]').dispatchEvent(new Event('click'));
  dom.submit();
  assert.equal(dom.applied.at(-1).folder, null);
  assert.equal(dom.applied.at(-1).project, null);
  assert.equal(dom.window.location.search, '');
});
