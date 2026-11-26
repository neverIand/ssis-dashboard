import assert from 'node:assert/strict';
import test from 'node:test';
import { expectStyle, loadStylesheet } from './css-rules.js';
import { mountOverview } from '../src/render-overview.js';
import { defaultSelection, validateSelection } from '../src/selection.js';
import { overviewDOM } from './overview-dom.js';
import { overviewPage, timelineMetadata, timelinePage, timelineSummary } from './timeline-fixture.js';
import { mountTableViewport } from '../src/table-viewport.js';
import { wireTime } from './fixtures.js';

const metadata = timelineMetadata();
const selection = () => validateSelection(defaultSelection(metadata), metadata);
function screen(t, { list = () => overviewPage(), summary = () => timelineSummary(), timeline = () => timelinePage() } = {}) {
  const dom = overviewDOM(), selected = [], calls = [];
  const view = mountOverview(dom.root, { metadata, appBase: '/ops/app/', onSelect: changes => selected.push(changes),
    api: { async get(resource, options) {
      calls.push(resource);
      return resource === 'executions' ? list(options) : resource === 'metrics/summary' ? summary(options) : timeline(options);
    } } });
  t.after(view.dispose);
  return { ...dom, view, selected, calls };
}

test('R1-2: header stickiness and clipping depend on a measured fit, never on width alone', async t => {
  const dom = screen(t);
  dom.scroll.clientWidth = 900;
  await dom.view.apply(selection());
  assert.equal(dom.scroll.dataset.fits, '', 'an 800 px table fits a 900 px region');
  dom.scroll.clientWidth = 700;
  await dom.view.refresh();
  assert.equal(dom.scroll.dataset.fits, undefined, 'a wider table keeps its horizontal scroll');
  const sheet = await loadStylesheet();
  await expectStyle(assert, sheet, '[data-sticky-table][data-fits]', 'overflow-x', 'clip', { width: 1400 });
  for (const width of [420, 600, 1400]) {
    assert.equal(await sheet.get('[data-sticky-table]', 'overflow-x', { width }), undefined, 'no width-only clip');
  }
  // Every horizontal clip in the sheet (overflow-x, or the first value of the overflow shorthand), at any width or
  // condition, depends on a measured fit: its selector requires [data-fits] outside any :not().
  const clips = [...sheet.setting('overflow-x', value => value.startsWith('clip')),
    ...sheet.setting('overflow', value => value.startsWith('clip'))];
  assert.ok(clips.length);
  const positive = selector => { let text = selector, before; do { before = text; text = text.replace(/:not\([^()]*\)/g, ''); } while (text !== before); return text; };
  // Each :is() branch on its own must still require the fit.
  for (const { selector, branches } of clips) {
    for (const branch of branches) assert.match(positive(branch), /\[data-fits\]/, `${selector} → ${branch}`);
  }
  // The scroll region scrolls sideways at every width and never on the vertical axis, so a sticky header row
  // keeps the page as its scroll container; a fitted table clips sideways instead.
  for (const width of [420, 900, 1400]) {
    await expectStyle(assert, sheet, '.table-scroll', 'overflow-x', 'auto', { width });
    for (const selector of ['.table-scroll', '[data-sticky-table]', '[data-sticky-table][data-fits]']) {
      assert.equal(await sheet.get(selector, 'overflow-y', { width }), undefined, `${selector} ${width} px`);
    }
  }
  // A fitted table's header row sticks below the toolbar on wider screens.
  await expectStyle(assert, sheet, '[data-sticky-table][data-fits] thead th', 'position', 'sticky', { width: 1400 });
});

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
