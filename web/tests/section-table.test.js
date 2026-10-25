import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSectionTable } from '../src/section-table.js';
import { detailDOM } from './detail-fixture.js';
import { eventMetadata } from './event-fixture.js';
import { wireTime } from './fixtures.js';

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
  assert.match(status.title, /^Unavailable\. Request ID: req-1 Previous row page shown\. Page 1 · 1 rows · Observed /);
  assert.ok(status.title.endsWith(wireTime));
  run.view.render(state([], { page: null, phase: 'loading' }), true, true);
  assert.equal(status.textContent, 'Loading rows…');
  assert.equal(run.eventBody.firstChild.firstChild.colSpan, 3);
  assert.equal(run.eventBody.textContent, 'Loading rows…');
  run.view.render(state([], { pageNumber: 2 }), false, true);
  assert.equal(run.eventBody.textContent, 'No rows remain.');
  assert.equal(run.rows.size, 0);
  run.view.render(state([], { open: false }), false, true);
  assert.equal(status.textContent, '');
  assert.equal(status.title, '');
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
