import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mountOverview } from '../src/render-overview.js';
import { mountDetail } from '../src/render-detail.js';
import { mountSectionTable } from '../src/section-table.js';
import { mountTableViewport } from '../src/table-viewport.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { deferred, wireTime } from './fixtures.js';
import { overviewDOM } from './overview-dom.js';
import { timelineMetadata, overviewPage, timelineSummary } from './timeline-fixture.js';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const settle = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };
const click = node => { node.focus(); node.dispatchEvent(new Event('click')); };

// Deliberate geometry, not a browser/layout claim. A sticky toolbar's natural document top is 460 px.
function geometry(window, table, scroll, toolbar) {
  const header = { top: -150, bottom: -120 }, calls = [];
  window.scrollY = 700;
  window.scrollX = 13;
  scroll.clientWidth = 900;
  scroll.style.setProperty = (key, value) => { scroll.style[key] = value; };
  scroll.style.removeProperty = key => { delete scroll.style[key]; };
  toolbar.style.position = 'sticky';
  toolbar.getBoundingClientRect = () => {
    const natural = 460 - window.scrollY;
    const top = toolbar.style.position === 'static' ? natural : Math.max(0, natural);
    return { top, bottom: top + 40, height: 40, width: 800 };
  };
  table.querySelector('thead').getBoundingClientRect = () => ({ ...header, height: header.bottom - header.top });
  window.scrollTo = (x, y) => {
    const request = typeof x === 'object' ? x : { left: x, top: y };
    calls.push(request);
    window.scrollX = request.left;
    window.scrollY = request.top;
  };
  return { header, calls };
}

const page = () => ({ data: [], meta: { generated_at: wireTime } });
const state = changes => ({ open: true, query: { limit: 50 }, phase: 'ready',
  page: page(), pageNumber: 1, hasPrevious: true, hasNext: true, error: null, stale: false, notice: '', ...changes });

for (const resource of ['executables', 'children', 'events', 'parameters', 'overrides', 'history']) {
  test(`B2/B3 ${resource}: sticky fit, explicit paging and Rows reveal only an obscured header after loading`, async t => {
    const dom = detailDOM(), table = dom.get(`${resource}-table`), scroll = dom.get(`${resource}-scroll`);
    const toolbar = dom.get(`${resource}-toolbar`), measured = geometry(dom.window, table, scroll, toolbar);
    const actions = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'order'].map(key => [key, () => {}]));
    const owner = mountSectionTable(dom.root, { metadata: timelineMetadata(), actions }, { resource, columns: 1, identity: 'id' });
    const view = owner.mount({ loading: 'Loading…', notLoaded: 'Not loaded.', previousPage: 'Previous page shown.',
      emptyMessage: () => 'Empty.', pageInfo: () => 'Page loaded.' });
    t.after(view.dispose);
    view.render(state(), false, true);
    assert.equal(measured.calls.length, 0, 'initial load leaves the window alone');
    assert.equal(toolbar.dataset.stickyToolbar, '');
    assert.equal(scroll.dataset.stickyTable, '');
    assert.equal(scroll.dataset.fits, '');
    assert.equal(scroll.style['--sd-list-toolbar-height'], '40px');
    scroll.clientWidth = 799.4;
    dom.window.dispatchEvent(new Event('resize'));
    assert.equal(scroll.dataset.fits, undefined, 'sideways scrolling remains available');
    scroll.clientWidth = 799.5;
    dom.window.dispatchEvent(new Event('resize'));
    assert.equal(scroll.dataset.fits, '', 'half-pixel fit tolerance matches Overview');

    const next = dom.get(`${resource}-next`);
    click(next);
    view.render(state({ page: null, phase: 'loading' }), true, true);
    assert.equal(measured.calls.length, 0, 'loading does not scroll');
    view.render(state({ pageNumber: 2 }), false, true);
    await Promise.resolve();
    assert.deepEqual(measured.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
    assert.equal(dom.document.activeElement, next, 'pager focus stays put');
    assert.equal(toolbar.style.position, 'sticky');

    Object.assign(measured.header, { top: 40, bottom: 70 });
    click(dom.get(`${resource}-previous`));
    view.render(state(), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 1, 'a fully visible header does not scroll');
    Object.assign(measured.header, { top: 25, bottom: 55 });
    click(dom.get(`${resource}-latest`));
    view.render(state(), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 2, 'a header partly behind the sticky toolbar is revealed');

    const limit = dom.get(`${resource}-limit`);
    limit.focus(); limit.value = '25'; limit.dispatchEvent(new Event('change'));
    view.render(state({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3);
    assert.equal(dom.document.activeElement, limit);
    view.render(state({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3, 'automatic/manual refresh has no paging intent');
    limit.dispatchEvent(new Event('change'));
    view.render(state({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3, 'the unchanged Rows value is not a page change');

    click(next);
    view.render(state({ phase: 'error', error: { message: 'Failed.' } }), false, true);
    view.render(state(), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3, 'an error consumes paging intent; a later refresh cannot reveal it');
    view.dispose();
    assert.equal(scroll.dataset.stickyTable, undefined);
    assert.equal(toolbar.dataset.stickyToolbar, undefined);
    dom.window.dispatchEvent(new Event('resize'));
    assert.equal(scroll.dataset.fits, undefined, 'resize ownership ends on disposal');
  });
}

test('B3 shared restoration and rejected busy paging preserve the saved position', t => {
  const dom = detailDOM(), table = dom.get('history-table'), scroll = dom.get('history-scroll');
  const measured = geometry(dom.window, table, scroll, dom.get('history-toolbar'));
  const actions = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'order'].map(key => [key, () => {}]));
  const owner = mountSectionTable(dom.root, { metadata: timelineMetadata(), actions,
    restoreView: { left: 28, top: 16, focus: 'next' } }, { resource: 'history', columns: 1, identity: 'id' });
  const view = owner.mount({ emptyMessage: () => 'Empty.', pageInfo: () => 'Page loaded.' });
  t.after(view.dispose);
  view.render(state({ page: null, phase: 'loading' }), true, true);
  click(dom.get('history-next'));
  view.render(state(), false, true);
  assert.equal(measured.calls.length, 0);
  assert.equal(scroll.scrollLeft, 28);
  assert.equal(scroll.scrollTop, 16);
  assert.equal(dom.document.activeElement, dom.get('history-next'));
});

function overview(t, saved = null) {
  const dom = overviewDOM(), table = dom.root.querySelector('[data-execution-table]');
  const measured = geometry(dom.window, table, dom.scroll, dom.root.querySelector('.executions-toolbar'));
  let held = null;
  const reads = [];
  const view = mountOverview(dom.root, { metadata: timelineMetadata(), appBase: '/app/',
    retainedPaths: saved?.paths, restoreView: saved?.view,
    api: { async get(resource, { params }) {
      reads.push(resource);
      if (resource !== 'executions') return timelineSummary();
      const response = overviewPage({ limit: params.limit, sort: params.sort, direction: params.direction,
        has_more: true, next_cursor: 'page-two' });
      if (held) { const waiting = held; held = null; await waiting.promise; }
      return response;
    } } });
  t.after(view.dispose);
  return { ...dom, ...measured, view, reads, hold() { held = deferred(); return held; } };
}
const selection = changes => validateSelection({ ...defaultSelection(timelineMetadata()), ...changes }, timelineMetadata());

test('B3 Overview: Next/Previous/First/Rows wait for the new page; refresh, sort and filters leave the window alone', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = overview(t);
  await dom.view.apply(selection());
  assert.equal(dom.calls.length, 0);
  const wait = dom.hold(), next = dom.get('executions-next');
  click(next); await settle();
  assert.equal(dom.calls.length, 0);
  wait.resolve(); await settle();
  assert.deepEqual(dom.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
  assert.equal(dom.document.activeElement, next);

  Object.assign(dom.header, { top: 40, bottom: 70 });
  click(dom.get('executions-previous')); await settle();
  assert.equal(dom.calls.length, 1);
  Object.assign(dom.header, { top: -15, bottom: 15 });
  click(dom.get('executions-latest')); await settle();
  assert.equal(dom.calls.length, 2);
  await dom.view.apply(selection({ limit: 25 }));
  assert.equal(dom.calls.length, 3);
  await dom.view.refresh();
  click(dom.get('overview-refresh')); await settle();
  const beforePoll = dom.reads.filter(resource => resource === 'executions').length;
  t.mock.timers.tick(30000); await settle();
  assert.equal(dom.reads.filter(resource => resource === 'executions').length, beforePoll + 1);
  await dom.view.apply(selection({ limit: 25, sort: 'created_at' }));
  await dom.view.apply(selection({ limit: 25, folder: 'Another folder' }));
  assert.equal(dom.calls.length, 3, 'manual/automatic refresh, sort and same-size filters never reveal');
});

test('B3 Overview: retained-page restore keeps its saved window position', async t => {
  const first = overview(t);
  await first.view.apply(selection());
  click(first.get('executions-next')); await settle();
  first.window.scrollY = 310;
  const saved = first.view.checkpoint();
  first.view.dispose();
  const restored = overview(t, saved);
  await restored.view.apply(selection(), { restore: true });
  assert.deepEqual(restored.calls, [{ left: 13, top: 310 }]);
  assert.equal(restored.window.scrollY, 310);
});

test('B3 viewport: a header below the viewport is revealed, and non-sticky headers visible at zero stay put', async () => {
  const dom = overviewDOM(), table = dom.root.querySelector('[data-execution-table]');
  const toolbar = dom.root.querySelector('.executions-toolbar');
  const measured = geometry(dom.window, table, dom.scroll, toolbar);
  const viewport = mountTableViewport(table, dom.scroll, toolbar);
  toolbar.style.position = 'static';
  Object.assign(measured.header, { top: 0, bottom: 30 });
  viewport.update(page(), { busy: false });
  viewport.pageChange(); viewport.update(page(), { busy: false });
  await Promise.resolve();
  assert.equal(measured.calls.length, 0);
  Object.assign(measured.header, { top: 880, bottom: 910 });
  viewport.pageChange(); viewport.update(page(), { busy: false });
  await Promise.resolve();
  assert.deepEqual(measured.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
  assert.equal(toolbar.style.position, 'static');
  viewport.dispose();
});

test('B3 detail paging reveals after the containing view preserves its window position, with no focus change', async t => {
  const dom = detailDOM(), table = dom.get('executables-table');
  const measured = geometry(dom.window, table, dom.get('executables-scroll'), dom.get('executables-toolbar'));
  const view = mountDetail(dom.root, { metadata: timelineMetadata(), executionId: '17', appBase: '/ops/app/',
    api: { async get(resource, { params }) {
      return resource.endsWith('/executables')
        ? executablePage(undefined, { ...params, has_more: true, next_cursor: 'page-two' }) : detailResponse('17');
    } } });
  t.after(view.dispose);
  await settle();
  assert.equal(measured.calls.length, 0);
  const next = dom.get('executables-next');
  click(next); await settle();
  assert.equal(dom.window.scrollY, 460, 'outer position preservation must not undo the page reveal');
  assert.deepEqual(measured.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
  assert.equal(dom.document.activeElement, next);
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(measured.calls.length, 1, 'full detail refresh still preserves position');
});

test('B3 a deferred reveal is cancelled by a subsequent load, restore, selection or disposal', async () => {
  for (const cancel of ['load', 'restore', 'selection', 'dispose']) {
    const dom = overviewDOM(), table = dom.root.querySelector('[data-execution-table]');
    const toolbar = dom.root.querySelector('.executions-toolbar');
    const measured = geometry(dom.window, table, dom.scroll, toolbar);
    const viewport = mountTableViewport(table, dom.scroll, toolbar);
    viewport.update(page(), { busy: false });
    viewport.pageChange(); viewport.update(page(), { busy: false });
    if (cancel === 'load') viewport.update(null, { busy: true });
    if (cancel === 'restore') viewport.update(page(), { busy: false, reveal: false });
    if (cancel === 'selection') viewport.cancelPageChange();
    if (cancel === 'dispose') viewport.dispose();
    await Promise.resolve();
    assert.equal(measured.calls.length, 0, cancel);
    viewport.dispose();
  }
});

test('B1/B2/B6 CSS keeps detail times intact, gates sticky headers by fit, and shares the Reset row with the tip', () => {
  const wide = css.match(/@media \(min-width: 66\.67rem\) \{([\s\S]*?)\n\}/)[1];
  assert.match(wide, /\[data-execution-table\] th:not\(:nth-child\(2\), :nth-child\(3\), \.count-cell\) \{ width: 1%; \}/);
  assert.match(wide, /\.time-cell \{ min-width: 0; max-width: 11\.5rem; \}/);
  assert.match(wide, /\[data-history-table\] col:is\(:nth-child\(1\), :nth-child\(6\)\) \{ width: auto; \}/);
  assert.doesNotMatch(wide, /executables|children/);
  assert.match(css, /\[data-children-table\] col:nth-child\(3\) \{ width: 12\.5rem; \}/);
  assert.match(css, /@media \(max-width: 66\.6667rem\)[\s\S]*?\.time-cell \{ min-width: 5\.6rem; white-space: normal; \}/);
  assert.match(css, /@media \(min-width: 49\.4rem\)[\s\S]*?\[data-sticky-toolbar\] \{ position: sticky; top: 0;/);
  assert.match(css, /\[data-sticky-table\]\[data-fits\] \{ overflow-x: clip; \}/);
  assert.match(css, /\[data-sticky-table\]\[data-fits\] thead th \{[^}]*top: var\(--sd-list-toolbar-height,[^}]*background: var\(--sd-subtle\)/);
  assert.match(css, /\.filter-meta \{[^}]*flex: 1; justify-content: end;/);
  assert.doesNotMatch(css, /\.filter-meta \{[^}]*flex-basis: 100%/);
});

test('Overview sorts in run column order and History has a separate trailing Status header', () => {
  const template = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const overview = template('index').match(/<table data-execution-table>[\s\S]*?<thead>([\s\S]*?)<\/thead>/)[1];
  assert.deepEqual([...overview.matchAll(/\('([a-z_]+)','([^']+)'\)/g)].map(match => match.slice(1)), [
    ['execution_id', 'ID'], ['project_name', 'Project'], ['package_name', 'Entry package'],
    ['created_at', 'Created'], ['started_at', 'Started'], ['duration_seconds', 'Duration'],
    ['warning_count', 'Warn'], ['error_count', 'Err'], ['status', 'Status'],
  ]);
  assert.match(overview, /key in \('warning_count', 'error_count'\) %\} class="number-cell count-cell"/);
  assert.match(overview, /<th scope="col" aria-sort="none"[^\n]+<button type="button" data-sort="\{\{ key \}\}" disabled>/);
  assert.match(css, /\.count-cell \{ width: (\d+(?:\.\d+)?rem); min-width: \1; max-width: \1;/);
  assert.match(css, /tr:is\(\[data-status="4"\], \[data-status="6"\]\) > td:first-child/);
  const history = template('history-panel');
  assert.deepEqual([...history.matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>|<span class="info-label">)?([A-Za-z]+)/g)]
    .map(match => match[1]),
    ['Execution', 'Created', 'Started', 'Ended', 'Duration', 'Estimate', 'Status']);
  assert.match(history, /<colgroup>(<col>){7}<\/colgroup>/);
  assert.match(history, /<td colspan="7">/);
});
