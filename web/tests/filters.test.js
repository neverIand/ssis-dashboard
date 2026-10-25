import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFilters } from '../src/filters.js';
import { deferred, envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';
import { parseSelection } from '../src/selection.js';
import { readOverviewReturn } from '../src/detail-navigation.js';

const settings = metadata(), folder = 'Fold\r\ner', project = 'Pro\nject';
const search = (folder, project) => '?' + new URLSearchParams({ folder, project });
const settled = () => new Promise(resolve => setImmediate(resolve));
function setup(t, query = '', effectiveWindow = () => null, customSettings = settings) {
  const dom = filtersDOM(customSettings, query), calls = [], applied = [];
  const filters = mountFilters(dom.root, { metadata: customSettings, appBase: '/dashboard/app/', effectiveWindow,
    onApplied: selection => applied.push(selection), api: { get: async (kind, { params }) => {
      calls.push({ kind, ...params });
      if (kind === 'meta') return envelope();
      const data = kind === 'folders' ? [{ folder_id: '1', name: folder, description: null }]
        : [{ project_id: '2', folder_id: '1', folder_name: params.folder, name: project, description: null }];
      return { ...envelope(data), meta: { ...envelope().meta, from: null, to: null, limit: params.limit,
        sort: 'name', direction: 'asc', has_more: false, next_cursor: null } };
    } } });
  t.after(() => filters.dispose());
  return { ...dom, calls, applied, select: filters.select };
}

test('both pickers use metadata max_limit for term searches and retain default_limit and focus for browsing', async t => {
  for (const key of ['folder', 'project']) {
    const dom = setup(t, search(folder, project));
    dom.open(key); await settled();
    const input = dom.get(`#${key}-search`);
    assert.equal(dom.calls.at(-1).limit, settings.limits.default_limit);
    dom.edit(`#${key}-search`, key === 'folder' ? 'Fold' : 'Pro');
    const enter = new Event('keydown'); Object.defineProperty(enter, 'key', { value: 'Enter' });
    input.dispatchEvent(enter); await settled();
    assert.equal(dom.calls.at(-1).limit, settings.limits.max_limit);
    assert.equal(dom.calls.at(-1).kind, `${key}s`);
    assert.equal(dom.calls.at(-1).folder, key === 'project' ? folder : null);
    assert.equal(dom.document.activeElement, input);
    assert.equal(dom.get(`[data-catalog-choices="${key}"]`).children.length, 1);
    dom.close(); dom.open(key); await settled();
    assert.equal(dom.calls.at(-1).limit, settings.limits.default_limit);
  }
});

test('max-limit Search more preserves moved focus and otherwise focuses the first new choice', async t => {
  for (const moveFocus of [false, true]) {
    const custom = metadata(); custom.limits.default_limit = 1; custom.limits.max_limit = 4;
    const dom = filtersDOM(custom), late = deferred(), calls = [];
    const response = (id, limit, next = null) => ({ ...envelope([{ folder_id: id, name: `Match ${id}`, description: null }]),
      meta: { ...envelope().meta, from: null, to: null, limit, sort: 'name', direction: 'asc',
        has_more: next !== null, next_cursor: next } });
    const filters = mountFilters(dom.root, { metadata: custom, appBase: '/dashboard/app/', api: { async get(kind, { params }) {
      calls.push(params);
      return params.cursor ? late.promise : response('1', params.limit, 'more');
    } } }); t.after(() => filters.dispose());
    dom.open('folder'); await settled();
    dom.edit('#folder-search', 'Match');
    const input = dom.get('#folder-search'), enter = new Event('keydown'); Object.defineProperty(enter, 'key', { value: 'Enter' });
    input.dispatchEvent(enter); await settled();
    const more = dom.get('[data-catalog-more="folder"]'); more.focus(); more.click();
    assert.equal(more.getAttribute('aria-disabled'), 'true');
    if (moveFocus) input.focus();
    late.resolve(response('2', 4)); await settled();
    assert.equal(calls.at(-1).limit, 4); assert.equal(calls.at(-1).cursor, 'more');
    assert.equal(dom.document.activeElement, moveFocus ? input : dom.get('[data-catalog-choices="folder"]').children[1]);
  }
});

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

test('status closes into one applied selection; range and scope changes preserve it and table order', async t => {
  const dom = setup(t, search('Old', project));
  dom.open('status');
  const status = dom.get('#status'); status.children[1].checked = true; status.dispatchEvent(new Event('change'));
  assert.deepEqual(dom.applied.at(-1).status, []);
  dom.close(); assert.deepEqual(dom.applied.at(-1).status, [1]);
  dom.open('created'); dom.click('[data-created-preset="custom"]');
  dom.edit('#from', '2026-10-17T00:00:00.0000001Z'); dom.click('[data-use-range]');
  dom.open('folder'); await settled();
  dom.get('[data-catalog-choices="folder"]').children[0].click();
  assert.equal(dom.applied.at(-1).folder, folder);
  assert.equal(dom.applied.at(-1).project, null);
  assert.deepEqual(dom.applied.at(-1).status, [1]);
  assert.equal(dom.applied.at(-1).from, '2026-10-17T00:00:00.0000001Z');
  const sort = dom.root.querySelector('[data-order="sort"]'); sort.value = 'execution_id:asc'; sort.dispatchEvent(new Event('change'));
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
  dom.open('created'); dom.click('[data-created-preset="custom"]');
  dom.edit('#from-date', '2026-10-24'); dom.edit('#to-date', '2026-10-25'); dom.click('[data-use-range]');
  assert.equal(dom.applied.at(-1).from, '2026-10-23T23:00:00Z', 'Use range commits immediately');
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
  const dom = setup(t); dom.open('created'); dom.click('[data-created-preset="custom"]');
  dom.get('#include-time').checked = true; dom.get('#include-time').dispatchEvent(new Event('change'));
  dom.edit('#from-date', '2026-10-25'); dom.edit('#from-time', '01:30'); dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /occurs twice/);
  assert.equal(dom.get('[data-occurrence-label="from"]').hidden, false);
  dom.edit('#from-occurrence', '1', 'change'); dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-25T01:30:00Z');
  dom.open('created'); dom.edit('#from-date', '2026-03-29'); dom.edit('#from-time', '01:30'); dom.click('[data-use-range]');
  assert.match(dom.get('[data-time-notice]').textContent, /skipped/);
});

test('each relative preset applies in one click without another metadata request', t => {
  const dom = setup(t);
  for (const token of ['24h','7d','30d','today']) {
    const count = dom.applied.length;
    dom.open('created'); dom.click(`[data-created-preset="${token}"]`);
    assert.equal(dom.applied.length, count + 1);
    assert.equal(dom.applied.at(-1).created, token); assert.equal(dom.applied.at(-1).from, null);
    assert.equal(dom.window.location.searchParams.get('created'), token);
    assert.match(dom.get('[data-filter-label="created"]').textContent, /Last|Today/);
  }
  assert.equal(dom.calls.length, 0);
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
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/', api: {
    get: () => [Promise.resolve(page('1', 'second')), second.promise, third.promise][calls++],
  } });
  t.after(() => filters.dispose());
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

test('unchanged closes send nothing; status Done, outside pointer and keyboard focus each commit once', t => {
  const dom = setup(t);
  dom.open('status'); dom.close(); dom.open('created'); dom.close();
  assert.equal(dom.applied.length, 1); assert.equal(dom.calls.length, 0);
  for (const via of ['done','pointer','focus']) {
    dom.open('status');
    const status = dom.get('#status'), box = status.children[1];
    box.checked = !box.checked; status.dispatchEvent(new Event('change'));
    const before = dom.applied.length;
    if (via === 'done') dom.close();
    else dom.document.dispatchEvent(new Event(via === 'pointer' ? 'pointerdown' : 'focusin'));
    assert.equal(dom.applied.length, before + 1, via);
    dom.close(); assert.equal(dom.applied.length, before + 1, 'Second close is inert');
  }
});

test('Escape discards Status changes, restores checked values and focus, and cannot leak into a later commit', t => {
  const dom = setup(t, '?status=1');
  const applied = dom.applied.at(-1), query = dom.window.location.search;
  dom.open('status');
  const status = dom.get('#status');
  status.children[1].checked = false; status.children[2].checked = true;
  status.dispatchEvent(new Event('change'));
  const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' });
  dom.form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.applied.length, 1);
  assert.equal(dom.window.location.search, query);
  assert.equal(dom.get('[data-filter-panel="status"]').hidden, true);
  assert.equal(dom.document.activeElement, dom.get('[data-open-filter="status"]'));
  dom.open('status');
  assert.deepEqual(status.children.filter(node => node.checked).map(node => node.value), ['1']);
  dom.close(); assert.equal(dom.applied.length, 1);
  dom.select({ limit: 100 });
  assert.deepEqual(dom.applied.at(-1).status, applied.status);
});

test('custom inputs prefill the current effective preset window and preserve exact fractional bounds', t => {
  const from = '2026-10-16T16:00:00.1234567Z', to = '2026-10-17T16:00:00.1234567Z';
  const dom = setup(t, '?created=24h', () => ({ from, to }));
  dom.open('created'); dom.click('[data-created-preset="custom"]');
  assert.equal(dom.get('#from-date').value, '2026-10-16');
  assert.equal(dom.get('#from-time').value, '17:00:00');
  assert.equal(dom.get('#to-date').value, '2026-10-17');
  assert.equal(dom.get('#to-time').value, '17:00:00');
  assert.equal(dom.get('#include-time').checked, true);
  dom.click('[data-use-range]');
  assert.equal(dom.applied.length, 2);
  assert.equal(dom.applied.at(-1).created, null);
  assert.equal(dom.applied.at(-1).from, from); assert.equal(dom.applied.at(-1).to, to);
  assert.equal(dom.window.location.searchParams.has('created'), false);
});

test('table headers toggle aria-sort, additional keys remain visible and page sizes retain arbitrary URL limits', t => {
  const custom = metadata(); custom.execution_sorts.push('ended_at','environment','logging_level');
  const dom = setup(t, '?limit=37', () => null, custom);
  const get = selector => dom.root.querySelector(selector);
  const size = get('[data-order="limit"]');
  assert.deepEqual(size.children.map(option => option.value), ['25','37','50','100','200']);
  assert.equal(size.value, '37');
  const id = get('[data-sort="execution_id"]'), created = get('[data-sort="created_at"]');
  assert.equal(id.parentElement.getAttribute('aria-sort'), 'descending');
  created.click(); assert.equal(created.parentElement.getAttribute('aria-sort'), 'descending');
  assert.equal(id.parentElement.getAttribute('aria-sort'), 'none');
  created.click(); assert.equal(created.parentElement.getAttribute('aria-sort'), 'ascending');
  for (const key of ['ended_at','environment','logging_level']) {
    const sort = get('[data-order="sort"]'); sort.value = `${key}:asc`; sort.dispatchEvent(new Event('change'));
    assert.equal(dom.applied.at(-1).sort, key);
    assert.equal(get('[data-order="sort"]').value, `${key}:asc`);
    assert.ok(get('[data-order="sort"]').children.some(option => option.value === `${key}:asc` && /Ended|Environment|Logging level/.test(option.textContent)));
    assert.equal(created.parentElement.getAttribute('aria-sort'), 'none');
  }
  size.value = '100'; size.dispatchEvent(new Event('change'));
  assert.equal(dom.applied.at(-1).limit, 100);
  assert.equal(dom.window.location.searchParams.get('limit'), '100');
  const narrow = metadata(); narrow.limits.max_limit = 30; narrow.limits.default_limit = 17;
  const limited = setup(t, '', () => null, narrow).root.querySelector('[data-order="limit"]');
  assert.deepEqual(limited.children.map(option => option.value), ['17','25']);
});

test('new numeric and time header sorts start descending; name and category sorts start ascending', t => {
  const custom = metadata();
  custom.execution_sorts = ['execution_id','created_at','started_at','duration_seconds','warning_count','error_count',
    'project_name','package_name','status'];
  const dom = setup(t, '', () => null, custom);
  for (const [key, direction] of [['created_at','desc'], ['started_at','desc'], ['duration_seconds','desc'],
    ['warning_count','desc'], ['error_count','desc'], ['execution_id','desc'], ['project_name','asc'],
    ['package_name','asc'], ['status','asc']]) {
    const header = dom.root.querySelector(`[data-sort="${key}"]`);
    header.click();
    assert.equal(dom.applied.at(-1).sort, key);
    assert.equal(dom.applied.at(-1).direction, direction, key);
    header.click();
    assert.equal(dom.applied.at(-1).direction, direction === 'desc' ? 'asc' : 'desc', key);
  }
});

test('row scopes set folder and project together and selection links apply status filters once', t => {
  const dom = setup(t, '?folder=Old&project=Old');
  dom.select({ folder, project });
  assert.equal(dom.applied.at(-1).folder, folder); assert.equal(dom.applied.at(-1).project, project);
  dom.select({ folder: 'Another' }); assert.equal(dom.applied.at(-1).project, null);
  const before = dom.applied.length;
  dom.select({ status: [2] }); dom.select({ status: [2] });
  assert.equal(dom.applied.length, before + 1);
  assert.equal(dom.window.location.searchParams.get('status'), '2');
});

function eventAt(type, target) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

test('clicking a card/header/scope with an open Status draft commits one merged change', t => {
  for (const changes of [{ status: [2] }, { sort: 'created_at', direction: 'asc' }, { folder, project }]) {
    const dom = setup(t); dom.open('status');
    const status = dom.get('#status'); status.children[1].checked = true; status.dispatchEvent(new Event('change'));
    const action = dom.document.createElement('a'); action.dataset.selectionLink = '';
    const pointer = eventAt('pointerdown', action); dom.document.dispatchEvent(pointer);
    assert.equal(pointer.defaultPrevented, true, 'Do not clear rows or move pointer focus before click');
    assert.equal(dom.applied.length, 1);
    dom.select(changes); dom.document.dispatchEvent(eventAt('click', action));
    assert.equal(dom.applied.length, 2);
    assert.deepEqual(dom.applied.at(-1).status, changes.status ?? [1]);
  }
});

test('a detail link consumes closing Status into its URL before rows can be cleared', t => {
  for (const activation of ['click','auxclick']) {
    for (const fragment of ['', '#events/errors', '#events/warnings']) {
    const dom = setup(t, '?created=24h'); dom.open('status');
    const status = dom.get('#status'); status.children[2].checked = true; status.dispatchEvent(new Event('change'));
    const link = dom.document.createElement('a'); link.dataset.executionLink = ''; link.dataset.executionId = '17';
    link.href = '/dashboard/app/executions/17' + fragment;
    const pointer = eventAt('pointerdown', link); dom.document.dispatchEvent(pointer);
    assert.equal(pointer.defaultPrevented, true); assert.equal(dom.applied.length, 1);
    const click = eventAt(activation, link); dom.document.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'Native link activation remains available');
    assert.equal(dom.applied.length, 2); assert.deepEqual(dom.applied.at(-1).status, [2]);
    const url = new URL(link.getAttribute('href'), dom.window.location.origin);
    assert.equal(url.hash, fragment, 'Status commit preserves the event category');
    const returned = readOverviewReturn(url.search, { metadata: settings, appBase: '/dashboard/app/', origin: dom.window.location.origin });
    assert.deepEqual(parseSelection(new URL(returned.href, dom.window.location.origin).search, settings).status, [2]);
    assert.equal(returned.selection.created, '24h');
    }
  }
});
