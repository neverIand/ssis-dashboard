import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectStyle, loadStylesheet } from './css-rules.js';
import { mountFilters } from '../src/filters.js';
import { deferred, envelope, metadata } from './fixtures.js';
import { filtersDOM } from './filters-dom.js';
import { parseSelection } from '../src/selection.js';
import { readOverviewReturn } from '../src/detail-navigation.js';
import { rangeLabel } from '../src/time-range.js';

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

test('clearing folder and project searches restores the list and leaves the applied scope alone', async t => {
  await Promise.all(['folder', 'project'].map(async key => {
    const dom = setup(t, search(folder, project)), selector = `#${key}-search`, input = dom.get(selector);
    const clear = dom.get(`[data-clear-picker="${key}"]`), exact = dom.get(`[data-exact-scope="${key}"]`);
    const choices = dom.get(`[data-catalog-choices="${key}"]`), all = dom.get(`[data-all-scope="${key}"]`);
    dom.open(key); await settled();
    assert.equal(input.value, ''); assert.equal(clear.hidden, true);
    assert.equal(all.getAttribute('aria-pressed'), 'false');
    dom.edit(selector, 'No match');
    assert.equal(clear.hidden, false); assert.equal(exact.hidden, false);
    input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' })); await settled();
    assert.equal(choices.children.length, 0);
    assert.equal(dom.calls.at(-1).limit, settings.limits.max_limit);

    clear.focus(); clear.click();
    assert.equal(input.value, ''); assert.equal(clear.hidden, true); assert.equal(exact.hidden, true);
    assert.equal(dom.document.activeElement, input);
    await new Promise(resolve => setTimeout(resolve, 275));
    assert.equal(choices.children.length, 1);
    assert.equal(dom.calls.at(-1).limit, settings.limits.default_limit);
    assert.equal(dom.calls.at(-1).folder, key === 'project' ? folder : null);
    assert.equal(dom.applied.length, 1);
    assert.equal(dom.applied.at(-1)[key], key === 'folder' ? folder : project);

    dom.edit(selector, 'Another search'); dom.close(); dom.open(key);
    assert.equal(input.value, ''); assert.equal(clear.hidden, true);
    all.click();
    assert.equal(dom.applied.at(-1)[key], null);
  }));
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
  dom.click('[data-status-done]'); assert.deepEqual(dom.applied.at(-1).status, [1]);
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
  dom.open('created'); dom.edit('#from-date', '2026-01-01'); dom.click('[data-cancel-range]');
  assert.equal(dom.document.activeElement, dom.get('[data-open-filter="created"]'));
  dom.submit();
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

test('a whole date at a repeated midnight applies without an occurrence choice; an entered midnight asks', t => {
  const azores = { ...settings, display_timezone: 'Atlantic/Azores' };
  const dom = setup(t, '', () => null, azores); dom.open('created'); dom.click('[data-created-preset="custom"]');
  dom.edit('#from-date', '2026-10-25'); dom.edit('#to-date', '2026-10-25');
  assert.equal(dom.get('[data-occurrence-label="from"]').hidden, true);
  dom.click('[data-use-range]'); dom.submit();
  assert.deepEqual([dom.applied.at(-1).from, dom.applied.at(-1).to], ['2026-10-25T00:00:00Z', '2026-10-26T01:00:00Z']);
  dom.open('created');
  dom.get('#include-time').checked = true; dom.get('#include-time').dispatchEvent(new Event('change'));
  dom.edit('#from-date', '2026-10-25'); dom.edit('#from-time', '00:00'); dom.edit('#to-date', '2026-10-25'); dom.edit('#to-time', '12:00');
  assert.equal(dom.get('[data-occurrence-label="from"]').hidden, false);
  dom.edit('#from-occurrence', '1', 'change'); dom.click('[data-use-range]'); dom.submit();
  assert.equal(dom.applied.at(-1).from, '2026-10-25T01:00:00Z');
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

test('presets longer than the configured maximum are hidden; Last 180 days applies once allowed', t => {
  const hidden = setup(t);
  for (const [token, off] of [['30d', false], ['180d', true]]) {
    const button = hidden.get(`[data-created-preset="${token}"]`);
    assert.equal(button.hidden, off); assert.equal(button.disabled, off);
  }
  const roomy = { ...settings, limits: { ...settings.limits, max_range_hours: 4320 } };
  const dom = setup(t, '', () => null, roomy);
  assert.equal(dom.get('[data-created-preset="180d"]').hidden, false);
  dom.open('created'); dom.click('[data-created-preset="180d"]');
  assert.equal(dom.applied.at(-1).created, '180d'); assert.equal(dom.window.location.searchParams.get('created'), '180d');
  assert.equal(dom.get('[data-filter-label="created"]').textContent, 'Last 180 days');
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
    const before = dom.applied.length, outside = dom.document.createElement('button');
    if (via === 'done') dom.click('[data-status-done]');
    else if (via === 'pointer') dom.get('[data-filter-panel="status"]').hidePopover();
    else { outside.focus(); dom.document.dispatchEvent(eventAt('focusin', outside)); }
    assert.equal(dom.applied.length, before + 1, via);
    assert.equal(dom.document.activeElement, via === 'focus' ? outside : dom.get('[data-open-filter="status"]'), via);
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
  dom.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.applied.length, 1);
  assert.equal(dom.window.location.search, query);
  assert.equal(!dom.get('[data-filter-panel="status"]').matches(':popover-open'), true);
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
    assert.equal(header.parentElement.getAttribute('aria-sort'), direction === 'desc' ? 'descending' : 'ascending');
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
    assert.equal(pointer.defaultPrevented, false, 'Native pointer focus is allowed; the draft waits for activation');
    dom.get('[data-filter-panel="status"]').hidePopover();
    assert.equal(dom.applied.length, 1);
    dom.select(changes); dom.document.dispatchEvent(eventAt('click', action));
    assert.equal(dom.applied.length, 2);
    assert.deepEqual(dom.applied.at(-1).status, changes.status ?? [1]);
  }
});

test('a timeline drill with an open Status draft commits status and bucket range once (UX B3, Codex R1-1)', t => {
  const dom = setup(t); dom.open('status');
  const status = dom.get('#status'); status.children[1].checked = true; status.dispatchEvent(new Event('change'));
  const drill = dom.document.createElement('button'); drill.dataset.selectionAction = '';
  const pointer = eventAt('pointerdown', drill); dom.document.dispatchEvent(pointer);
  assert.equal(pointer.defaultPrevented, false, 'the chart can receive focus before its merged drill');
  dom.get('[data-filter-panel="status"]').hidePopover();
  assert.equal(dom.applied.length, 1);
  const range = { created: null, from: '2026-10-17T00:00:00.0000000Z', to: '2026-10-17T05:00:00.0000000Z' };
  dom.select(range); dom.document.dispatchEvent(eventAt('click', drill));
  assert.equal(dom.applied.length, 2);
  assert.deepEqual([dom.applied.at(-1).status, dom.applied.at(-1).from, dom.applied.at(-1).to], [[1], range.from, range.to]);
});

test('a single timeline click keeps the Status draft visible and cancellable or committable (F001)', t => {
  for (const finish of ['Escape', 'Done', 'outside focus']) {
    const dom = setup(t); dom.open('status');
    const status = dom.get('#status'), panel = dom.get('[data-filter-panel="status"]');
    status.children[1].checked = true; status.dispatchEvent(new Event('change'));
    const bar = dom.document.createElement('g'); bar.dataset.selectionAction = '';
    dom.document.dispatchEvent(eventAt('pointerdown', bar));
    bar.focus();
    panel.hidePopover();
    dom.document.dispatchEvent(eventAt('click', bar));
    assert.equal(panel.matches(':popover-open'), true, 'the uncommitted draft stays visible after a lone chart click');
    assert.equal(dom.applied.length, 1);
    assert.equal(dom.window.location.search, '');
    assert.equal(status.children[1].checked, true);
    assert.equal(dom.document.activeElement, bar, 'restoring the picker preserves the chart activation focus');
    assert.equal(dom.get('[data-filter-notice]').textContent, 'Close Status to apply; Escape cancels.');
    if (finish === 'Escape') {
      const escape = eventAt('keydown', dom.document.activeElement);
      Object.defineProperty(escape, 'key', { value: 'Escape' });
      dom.document.dispatchEvent(escape);
      assert.equal(escape.defaultPrevented, true);
      assert.equal(dom.applied.length, 1);
      assert.equal(dom.window.location.search, '');
      assert.equal(status.children[1].checked, false);
    } else {
      if (finish === 'Done') dom.click('[data-status-done]');
      else dom.document.dispatchEvent(eventAt('focusin', bar));
      assert.equal(dom.applied.length, 2);
      assert.deepEqual(dom.applied.at(-1).status, [1]);
      assert.equal(dom.window.location.searchParams.get('status'), '1');
    }
    assert.equal(panel.matches(':popover-open'), false);
    assert.equal(dom.get('[data-filter-notice]').textContent, '');
    dom.select({ limit: 100 });
    assert.deepEqual(dom.applied.at(-1).status, finish === 'Escape' ? [] : [1], 'no hidden draft can leak later');
  }
});

test('a canceled selection pointer leaves Status open and allows a later keyboard close (F002)', t => {
  for (const action of ['selectionAction', 'selectionLink', 'sort', 'executionLink']) {
    const dom = setup(t); dom.open('status');
    const status = dom.get('#status'), panel = dom.get('[data-filter-panel="status"]');
    status.children[1].checked = true; status.dispatchEvent(new Event('change'));
    const target = dom.document.createElement('button'); target.dataset[action] = '';
    dom.document.dispatchEvent(eventAt('pointerdown', target));
    dom.document.dispatchEvent(eventAt('pointercancel', target));
    assert.equal(panel.matches(':popover-open'), true);
    assert.equal(dom.applied.length, 1, 'canceling a pointer does not submit Status');
    dom.document.dispatchEvent(eventAt('focusin', target));
    assert.equal(panel.matches(':popover-open'), false, 'keyboard focus can close after a canceled pointer');
    assert.equal(dom.applied.length, 2);
    assert.deepEqual(dom.applied.at(-1).status, [1]);
  }
});

test('a timeline double click keeps an open Status draft through its first click (UX B3, Codex R2-1)', t => {
  const dom = setup(t); dom.open('status');
  const status = dom.get('#status'); status.children[1].checked = true; status.dispatchEvent(new Event('change'));
  const bar = dom.document.createElement('g'); bar.dataset.selectionAction = '';
  for (const type of ['pointerdown', 'click', 'pointerdown', 'click']) {
    dom.document.dispatchEvent(eventAt(type, bar));
    if (type === 'pointerdown') { bar.focus(); dom.get('[data-filter-panel="status"]').hidePopover(); }
    else assert.equal(dom.get('[data-filter-panel="status"]').matches(':popover-open'), true);
  }
  assert.equal(dom.applied.length, 1, 'no commit before the dblclick drill');
  assert.equal(dom.document.activeElement, bar, 'the drill can move focus from the chart to the list');
  const range = { created: null, from: '2026-10-17T00:00:00.0000000Z', to: '2026-10-17T05:00:00.0000000Z' };
  dom.select(range);
  assert.equal(dom.applied.length, 2);
  assert.deepEqual([dom.applied.at(-1).status, dom.applied.at(-1).from], [[1], range.from]);
});

test('a detail link consumes closing Status into its URL before rows can be cleared', t => {
  for (const activation of ['click','auxclick']) {
    for (const fragment of ['', '#events/errors', '#events/warnings']) {
    const dom = setup(t, '?created=24h'); dom.open('status');
    const status = dom.get('#status'); status.children[2].checked = true; status.dispatchEvent(new Event('change'));
    const link = dom.document.createElement('a'); link.dataset.executionLink = ''; link.dataset.executionId = '17';
    link.href = '/dashboard/app/executions/17' + fragment;
    const pointer = eventAt('pointerdown', link); dom.document.dispatchEvent(pointer);
    assert.equal(pointer.defaultPrevented, false); assert.equal(dom.applied.length, 1);
    dom.get('[data-filter-panel="status"]').hidePopover();
    assert.equal(dom.applied.length, 1, 'Native light dismiss must not consume the activation target');
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

test('a fragment-only history entry keeps the applied selection; a changed query still restores', t => {
  const dom = setup(t, search(folder, project));
  const applied = dom.applied.length;
  dom.window.dispatchEvent(new Event('popstate'));
  assert.equal(dom.applied.length, applied, 'same query: nothing is re-applied');
  dom.restore('?status=2');
  assert.equal(dom.applied.length, applied + 1);
  assert.deepEqual([...dom.applied.at(-1).status], [2]);
  dom.restore('?status=bad'); assert.equal(dom.applied.at(-1), null);
  dom.window.dispatchEvent(new Event('popstate'));
  assert.equal(dom.applied.at(-1), null, 'an invalid URL is still reported on every entry');
});

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('O7: the default range reads in days and exact timestamps sit under a closed Advanced disclosure', () => {
  const settings = metadata();
  settings.limits = { ...settings.limits, default_range_hours: 360 };
  const dom = filtersDOM(settings);
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/app/', effectiveWindow: () => null,
    onApplied: () => {}, api: { get: async () => envelope([]) } });
  assert.equal(dom.get('[data-created-preset="default"]'), null);
  assert.equal(dom.get('[data-filter-label="created"]').textContent, 'Last 15 days');
  filters.dispose?.();
  const html = source('../../dashboard/templates/app/index.html');
  assert.match(html, /<details class="exact-times"><summary>Advanced: exact timestamps<\/summary>/);
  assert.doesNotMatch(html, /<details class="exact-times" open/);
});

const templates = new URL('../../dashboard/templates/app/', import.meta.url);
const readTemplate = name => readFileSync(new URL(name, templates), 'utf8');
const overview = readTemplate('index.html'), historyPanel = readTemplate('history-panel.html');

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

function mount(t, hours = 24, maximum = 4320) {
  const settings = metadata();
  settings.limits = { ...settings.limits, default_range_hours: hours, max_range_hours: maximum };
  const dom = filtersDOM(settings), applied = [];
  const filters = mountFilters(dom.root, { metadata: settings, appBase: '/dashboard/app/',
    onApplied: selection => applied.push(selection), api: { get: async () => envelope([]) } });
  t.after(filters.dispose);
  return { ...dom, applied, settings, filters };
}

for (const [hours, label, pressed] of [[24, 'Last 24 hours', '24h'], [168, 'Last 7 days', '7d'],
  [360, 'Last 15 days', null], [25, 'Last 25 hours', null], [720, 'Last 30 days', '30d'], [4320, 'Last 180 days', '180d']]) {
  test(`B5 ${hours} default hours: trigger label, matching pressed preset and absent range URL`, t => {
    const dom = mount(t, hours);
    assert.equal(rangeLabel(dom.applied[0], 'Europe/London', hours), label);
    assert.equal(dom.get('[data-filter-label="created"]').textContent, label);
    assert.equal(dom.get('[data-open-filter="created"]').getAttribute('aria-label'), `Created: ${label}`);
    dom.get('[data-open-filter="created"]').click();
    const buttons = dom.form.querySelectorAll('[data-created-preset]');
    assert.deepEqual(buttons.map(button => button.dataset.createdPreset), ['today', '24h', '7d', '30d', '180d', 'custom']);
    assert.deepEqual(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')
      .map(button => button.dataset.createdPreset), pressed ? [pressed] : []);
    assert.equal(dom.document.activeElement, dom.get('[data-created-preset="today"]'));
    assert.equal(dom.get('[data-created-preset="default"]'), null);
    assert.equal(dom.applied[0].created, null);
    assert.equal(dom.applied[0].from, null);
    assert.equal(dom.applied[0].to, null);
    assert.equal(dom.window.location.search.includes('created='), false);
  });
}

test('B5 explicit preset selection and Reset keep the existing URL semantics and pressed state', t => {
  const dom = mount(t);
  dom.get('[data-open-filter="created"]').click();
  dom.get('[data-created-preset="7d"]').click();
  assert.equal(dom.applied.at(-1).created, '7d');
  assert.equal(dom.window.location.search, '?created=7d');
  dom.get('[data-open-filter="created"]').click();
  assert.equal(dom.get('[data-created-preset="7d"]').getAttribute('aria-pressed'), 'true');
  dom.get('[data-reset-filters]').click();
  assert.equal(dom.window.location.search, '');
  assert.equal(dom.get('[data-filter-label="created"]').textContent, 'Last 24 hours');
  dom.get('[data-open-filter="created"]').click();
  assert.equal(dom.get('[data-created-preset="24h"]').getAttribute('aria-pressed'), 'true');
});

test('B5 empty custom range reports the concise error and never applies it', t => {
  const dom = mount(t);
  dom.get('[data-open-filter="created"]').click();
  dom.get('[data-created-preset="custom"]').click();
  dom.get('[data-use-range]').click();
  assert.equal(dom.get('[data-time-notice]').textContent, 'Choose at least one date.');
  assert.equal(dom.applied.length, 1);
  assert.equal(dom.get('[data-created-preset="custom"]').getAttribute('aria-pressed'), 'true');
});

test('B4 the capped 180-day preset leaves the flow while the remaining presets keep their order', async t => {
  const dom = mount(t, 24, 744);
  const buttons = dom.form.querySelectorAll('[data-created-preset]');
  assert.deepEqual(buttons.filter(button => !button.hidden).map(button => button.dataset.createdPreset),
    ['today', '24h', '7d', '30d', 'custom']);
  assert.equal(dom.get('[data-created-preset="180d"]').disabled, true);
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, '.creation-presets', 'display', 'grid');
  await expectStyle(assert, sheet, '.creation-presets', 'grid-template-columns',
    'repeat(auto-fit, minmax(min(100%, max(10rem, calc((100% - 0.4rem) / 2))), 1fr))');
  await expectStyle(assert, sheet, '.creation-presets', 'gap', '0.4rem');
  await expectStyle(assert, sheet, '.creation-presets > button', 'white-space', 'nowrap');
  await expectStyle(assert, sheet, '.catalog-choice[aria-pressed="true"]', 'background', 'var(--sd-action-soft)');
  await expectStyle(assert, sheet, '[hidden]', 'display', 'none !important');
});
