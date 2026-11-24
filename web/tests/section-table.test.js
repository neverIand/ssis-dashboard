import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSectionTable } from '../src/section-table.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';
import { wireTime } from './fixtures.js';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { timelineMetadata } from './timeline-fixture.js';

function mount(t, { restoreView = null, ...options } = {}) {
  const dom = detailDOM(), calls = [];
  const actions = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'order']
    .map(key => [key, value => calls.push([key, value])]));
  const owner = mountSectionTable(dom.root, { metadata: eventMetadata(), actions, restoreView }, {
    resource: 'events', columns: 3, identity: 'id',
    disclosures: [{ saved: 'messages', field: 'details', focus: 'rowFocus', summary: 'summary', visible: true }],
    focusFallback: ['rowFocus'], ...options,
  });
  const view = owner.mount({
    loading: 'Loading rows…', notLoaded: 'No rows loaded.', previousPage: 'Previous row page shown.',
    emptyMessage: (_page, number) => number > 1 ? 'No rows remain.' : 'No rows.',
    pageInfo: (page, state) => `Page ${state.pageNumber} · ${page.data.length} rows`,
    paintRow(item, row) {
      if (!row) {
        const node = owner.element('tr'), cell = owner.element('td');
        const details = owner.element('details'), summary = owner.element('summary', 'Message');
        const label = owner.element('p');
        details.append(summary, label);
        cell.append(details);
        node.append(cell);
        row = { node, details, summary, label };
        owner.rows.set(item.id, row);
      }
      owner.text(row.label, item.text ?? item.id);
      row.details.hidden = item.hidden === true;
      return row;
    },
  });
  t.after(() => view.dispose());
  return { ...dom, owner, view, calls, rows: owner.rows, scroll: dom.get('events-scroll') };
}

const page = data => ({ data, meta: { generated_at: wireTime } });
const state = (data = [], changes = {}) => ({ open: true, query: { limit: 50 }, phase: 'ready',
  page: page(data), pageNumber: 1, hasPrevious: false, hasNext: false, error: null, stale: false, notice: '', ...changes });

test('shared table reorders keyed nodes, removes missing rows and preserves moved-row focus and scroll', t => {
  const run = mount(t);
  run.view.render(state([{ id: '1' }, { id: '2' }]), false, true);
  const first = run.rows.get('1'), second = run.rows.get('2');
  first.details.open = true;
  first.summary.focus();
  run.scroll.scrollLeft = 73;
  run.scroll.scrollTop = 29;
  run.document.onMutation = () => { run.scroll.scrollLeft = run.scroll.scrollTop = 0; };
  run.view.render(state([{ id: '2' }, { id: '1', text: '<literal>' }, { id: '3' }]), false, true);
  assert.deepEqual(run.eventBody.children, [second.node, first.node, run.rows.get('3').node]);
  assert.equal(first.details.open, true);
  assert.equal(first.label.textContent, '<literal>');
  assert.equal(run.document.activeElement, first.summary);
  assert.deepEqual([run.scroll.scrollLeft, run.scroll.scrollTop], [73, 29]);
  run.view.render(state([{ id: '2' }]), false, true);
  assert.equal(run.rows.has('1'), false);
  assert.equal(first.node.isConnected, false);
  assert.equal(run.document.activeElement, run.scroll);
});

test('shared table detects focused content hidden inside a retained row', t => {
  const run = mount(t);
  run.view.render(state([{ id: '1' }]), false, true);
  run.rows.get('1').summary.focus();
  run.view.render(state([{ id: '1', hidden: true }]), false, true);
  assert.equal(run.document.activeElement, run.scroll);
});

for (const focusMode of ['moved', 'removed']) test(`shared table preserves the ${focusMode} row-focus policy`, t => {
  const run = mount(t, { focusMode });
  run.view.render(state([{ id: '1' }, { id: '2' }]), false, true);
  const summary = run.rows.get('2').summary;
  summary.focus();
  run.view.render(state([{ id: '2' }, { id: '1' }]), false, true);
  assert.equal(run.document.activeElement, focusMode === 'moved' ? summary : null);
  summary.focus();
  run.view.render(state([{ id: '1' }]), false, true);
  assert.equal(run.document.activeElement, run.scroll);
});

test('shared status preserves error request IDs, stale wording, observation titles and bounded empty rows', t => {
  const run = mount(t), status = run.get('events-status');
  run.view.render(state([{ id: '1' }], { stale: true,
    error: { message: 'Unavailable.', requestId: 'req-1' } }), false, true);
  assert.equal(status.textContent, 'Unavailable. Request ID: req-1 Previous row page shown. Page 1 · 1 rows');
  assert.equal(status.title, 'Observed 2026-10-17 17:00:00 · Unavailable. Request ID: req-1');
  run.view.render(state([], { page: null, phase: 'loading' }), true, true);
  assert.equal(status.textContent, 'Loading rows…');
  assert.equal(status.title, '');
  assert.equal(run.eventBody.firstChild.firstChild.colSpan, 3);
  assert.equal(run.eventBody.textContent, 'Loading rows…');
  run.view.render(state([], { pageNumber: 2 }), false, true);
  assert.equal(run.eventBody.textContent, 'No rows remain.');
  assert.equal(run.rows.size, 0);
  run.view.render(state([], { open: false }), false, true);
  assert.equal(status.textContent, '');
  assert.equal(status.title, '');
});

test('shared recovery focuses the table region when its section toggle is hidden', t => {
  const run = mount(t), retry = run.get('events-retry');
  run.get('events-toggle').hidden = true;
  run.view.render(state([], { phase: 'error', error: { message: 'Retry.' } }), false, true);
  retry.focus();
  run.view.render(state([], { phase: 'loading' }), true, true);
  assert.equal(run.document.activeElement, retry);
  run.view.render(state([{ id: '1' }]), false, true);
  assert.equal(retry.hidden, true);
  assert.equal(run.document.activeElement, run.scroll);
});

test('shared controls keep Retry during busy recovery and return its focus when the error clears', t => {
  const run = mount(t), retry = run.get('events-retry');
  run.view.render(state([], { phase: 'error', error: { message: 'Retry.' } }), false, true);
  assert.equal(retry.hidden, false);
  retry.focus();
  run.view.render(state([], { phase: 'loading' }), true, true);
  assert.equal(retry.hidden, false);
  for (const key of ['retry', 'previous', 'next', 'latest']) {
    assert.equal(run.get(`events-${key}`).disabled, false);
    assert.equal(run.get(`events-${key}`).getAttribute('aria-disabled'), 'true');
  }
  assert.equal(run.get('events-table').getAttribute('aria-busy'), 'true');
  run.view.render(state([], { hasNext: true }), false, true);
  assert.equal(retry.hidden, true);
  assert.equal(run.document.activeElement, run.get('events-toggle'));
  assert.equal(run.get('events-previous').getAttribute('aria-disabled'), 'true');
  assert.equal(run.get('events-next').getAttribute('aria-disabled'), 'false');
});

test('shared restoration waits for a settled page and checkpoints only view anchors', t => {
  const run = mount(t, { restoreView: { messages: ['1', '2'], rowFocus: '1', left: 81, top: 24 } });
  const loaded = state([{ id: '1', text: 'private payload' }, { id: '2', hidden: true }]);
  run.view.render(loaded, true, true);
  assert.equal(run.rows.get('1').details.open, undefined);
  run.view.render(loaded, false, true);
  assert.equal(run.rows.get('1').details.open, true);
  assert.equal(run.rows.get('2').details.open, undefined);
  assert.equal(run.document.activeElement, run.rows.get('1').summary);
  assert.deepEqual(run.view.checkpoint(), { left: 81, top: 24, messages: ['1'], rowFocus: '1', focus: null });
  assert.doesNotMatch(JSON.stringify(run.view.checkpoint()), /private payload/);
  run.rows.get('1').details.open = false;
  run.view.render(loaded, false, true);
  assert.equal(run.rows.get('1').details.open, false);
});

test('shared restoration respects focus and scrolling moved while loading', t => {
  const run = mount(t, { restoreView: { messages: ['1'], rowFocus: '1', left: 81, top: 24 } });
  run.view.render(state([], { page: null, phase: 'loading' }), true, true);
  const next = run.get('events-next');
  next.focus();
  run.scroll.scrollLeft = 12;
  run.scroll.scrollTop = 9;
  run.view.render(state([{ id: '1' }]), false, true);
  assert.equal(run.rows.get('1').details.open, true);
  assert.equal(run.document.activeElement, next);
  assert.deepEqual([run.scroll.scrollLeft, run.scroll.scrollTop], [12, 9]);
});

test('shared restoration falls back for missing rows and is abandoned after the section closes', t => {
  const missing = mount(t, { restoreView: { messages: ['9'], rowFocus: '9', left: 3, top: 4 } });
  missing.view.render(state([{ id: '1' }]), false, true);
  assert.equal(missing.document.activeElement, missing.scroll);
  const closed = mount(t, { restoreView: { messages: ['1'], rowFocus: '1', left: 81, top: 24 } });
  closed.view.render(state([], { open: false, page: null }), false, true);
  closed.view.render(state([{ id: '1' }]), false, true);
  assert.equal(closed.rows.get('1').details.open, undefined);
  assert.equal(closed.document.activeElement, closed.document.body);
  assert.equal(closed.scroll.scrollLeft, 0);
});

test('shared capability denial clears rows and never restores retained view state', t => {
  const run = mount(t, { enabled: false, capability: true,
    restoreView: { messages: ['1'], rowFocus: '1', left: 81, top: 24 } });
  run.view.render(state([{ id: '1' }]), false, true);
  assert.equal(run.get('events-panel').hidden, true);
  assert.equal(run.get('events-unavailable').hidden, false);
  assert.equal(run.rows.size, 0);
  assert.equal(run.scroll.scrollLeft, 0);
  assert.equal(run.get('events-limit').disabled, true);
});

test('shared disposal removes toolbar and adapter listeners, clears state and releases loading space', t => {
  const run = mount(t);
  let inputs = 0;
  run.owner.listen(run.document, 'input', () => inputs++);
  run.get('events-next').dispatchEvent(new Event('click'));
  run.document.dispatchEvent(new Event('input'));
  assert.equal(run.calls.length, 1);
  assert.equal(inputs, 1);
  run.view.render(state([{ id: '1' }]), false, true);
  run.scroll.layoutHeight = 120;
  run.view.render(state([], { phase: 'loading', page: null }), true, true);
  assert.equal(run.scroll.style.minHeight, '120px');
  run.view.dispose();
  run.get('events-next').dispatchEvent(new Event('click'));
  run.document.dispatchEvent(new Event('input'));
  assert.equal(run.calls.length, 1);
  assert.equal(inputs, 1);
  assert.equal(run.eventBody.children.length, 0);
  assert.equal(run.get('events-status').textContent, '');
  assert.equal(run.get('events-panel').hidden, true);
  assert.equal(run.get('events-retry').hidden, true);
  assert.equal(run.scroll.style.minHeight, '');
  assert.equal(run.owner.state, null);
  for (const control of Object.values(run.owner.controls)) assert.equal(control.disabled, true);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const failed = (errors = 2) => {
  const response = detailResponse('17');
  response.data.status = { code: 4, name: 'failed' };
  response.data.error_count = errors;
  response.data.event_counts = { ...response.data.event_counts, all: 3 + errors, errors };
  return response;
};
const errorRow = (id, changes = {}) => eventRow(id, { event_name: 'OnError', message_type: 120,
  source_name: 'Data Flow Task', subcomponent_name: 'OLE DB Destination',
  message: `Error ${id}: ${'x'.repeat(300)} TAIL-${id}`, ...changes });
function mounted(t, { metadata = eventMetadata(), hash = '', legacy = '/ops/execution/17', detail = failed(),
  events = params => eventPage([errorRow('1'), errorRow('2')], params), prepare = () => {} } = {}) {
  const dom = detailDOM(), calls = [];
  dom.window.location.hash = hash;
  if (legacy !== null) dom.get('legacy-detail-link').setAttribute('href', legacy);
  prepare(dom);
  const screen = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/ops/app/', api: {
    async get(resource, { params = {} } = {}) {
      calls.push({ resource, params });
      return resource.endsWith('/events') ? events(params) : resource.endsWith('/executables') ? executablePage()
        : resource.endsWith('/children') ? childPage() : detail;
    } } });
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; screen.dispose(); } };
  t.after(dispose);
  return { ...dom, calls, dispose };
}

test('D7: a failed section read with nothing shown states the error and request ID in the table and wraps the status', async t => {
  const dom = mounted(t, { hash: '#events', events: () => { throw new ApiError('http', { status: 500, requestId: '0123456789abcdef0123456789abcdef' }); } });
  await flush(); await flush();
  assert.match(dom.eventBody.textContent, /Request ID: 0123456789abcdef0123456789abcdef/);
  assert.equal('error' in dom.get('events-status').dataset, true);
  assert.match(dom.get('events-status').textContent, /Request ID: 0123456789abcdef0123456789abcdef/);
});

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
const emptyPage = () => ({ data: [], meta: { generated_at: wireTime } });
const readyState = changes => ({ open: true, query: { limit: 50 }, phase: 'ready',
  page: emptyPage(), pageNumber: 1, hasPrevious: true, hasNext: true, error: null, stale: false, notice: '', ...changes });

for (const resource of ['executables', 'children', 'events', 'parameters', 'overrides', 'history']) {
  test(`B2/B3 ${resource}: sticky fit, explicit paging and Rows reveal only an obscured header after loading`, async t => {
    const dom = detailDOM(), table = dom.get(`${resource}-table`), scroll = dom.get(`${resource}-scroll`);
    const toolbar = dom.get(`${resource}-toolbar`), measured = geometry(dom.window, table, scroll, toolbar);
    const actions = Object.fromEntries(['toggle', 'retry', 'previous', 'next', 'latest', 'order'].map(key => [key, () => {}]));
    const owner = mountSectionTable(dom.root, { metadata: timelineMetadata(), actions }, { resource, columns: 1, identity: 'id' });
    const view = owner.mount({ loading: 'Loading…', notLoaded: 'Not loaded.', previousPage: 'Previous page shown.',
      emptyMessage: () => 'Empty.', pageInfo: () => 'Page loaded.' });
    t.after(view.dispose);
    view.render(readyState(), false, true);
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
    view.render(readyState({ page: null, phase: 'loading' }), true, true);
    assert.equal(measured.calls.length, 0, 'loading does not scroll');
    view.render(readyState({ pageNumber: 2 }), false, true);
    await Promise.resolve();
    assert.deepEqual(measured.calls, [{ left: 13, top: 460, behavior: 'instant' }]);
    assert.equal(dom.document.activeElement, next, 'pager focus stays put');
    assert.equal(toolbar.style.position, 'sticky');

    Object.assign(measured.header, { top: 40, bottom: 70 });
    click(dom.get(`${resource}-previous`));
    view.render(readyState(), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 1, 'a fully visible header does not scroll');
    Object.assign(measured.header, { top: 25, bottom: 55 });
    click(dom.get(`${resource}-latest`));
    view.render(readyState(), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 2, 'a header partly behind the sticky toolbar is revealed');

    const limit = dom.get(`${resource}-limit`);
    limit.focus(); limit.value = '25'; limit.dispatchEvent(new Event('change'));
    view.render(readyState({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3);
    assert.equal(dom.document.activeElement, limit);
    view.render(readyState({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3, 'automatic/manual refresh has no paging intent');
    limit.dispatchEvent(new Event('change'));
    view.render(readyState({ query: { limit: 25 } }), false, true);
    await Promise.resolve();
    assert.equal(measured.calls.length, 3, 'the unchanged Rows value is not a page change');

    click(next);
    view.render(readyState({ phase: 'error', error: { message: 'Failed.' } }), false, true);
    view.render(readyState(), false, true);
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
  view.render(readyState({ page: null, phase: 'loading' }), true, true);
  click(dom.get('history-next'));
  view.render(readyState(), false, true);
  assert.equal(measured.calls.length, 0);
  assert.equal(scroll.scrollLeft, 28);
  assert.equal(scroll.scrollTop, 16);
  assert.equal(dom.document.activeElement, dom.get('history-next'));
});
