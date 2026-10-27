import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { mountInfoTips } from '../src/ui.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { eventPage } from './event-fixture.js';
import { historyMetadata, historyPage, historyRow } from './history-fixture.js';
import { deferred, requestId } from './fixtures.js';
import { Node } from './overview-dom.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const click = node => node.dispatchEvent(new Event('click'));
function dispatch(node, type, target, key) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  if (key) Object.defineProperty(event, 'key', { value: key });
  node.dispatchEvent(event); return event;
}
function screen(t, { tab = 'history', read = () => historyPage(), response = () => detailResponse('17') } = {}) {
  const dom = detailDOM(), calls = [], metadata = historyMetadata();
  metadata.capabilities.events = true;
  metadata.event_kinds = ['all', 'errors', 'warnings'];
  dom.window.location.hash = `#${tab}`;
  const view = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/app/', api: {
    async get(resource, options) {
      calls.push({ resource, ...options });
      return resource === 'history' || resource.endsWith('/events') ? read(resource, options) : response();
    },
  } });
  t.after(view.dispose);
  return { ...dom, calls, view };
}
const chooseStatuses = (dom, codes) => {
  for (const label of dom.get('history-choices').children) label.firstChild.checked = codes.includes(label.firstChild.value);
};

test('Custom status popover applies exactly once on close; Escape cancels and restores the applied checks', async t => {
  const dom = screen(t); await flush(); const count = dom.calls.length;
  click(dom.get('history-custom')); chooseStatuses(dom, ['4', '7']);
  assert.equal(dom.get('history-custom').getAttribute('aria-expanded'), 'true');
  assert.equal(dom.calls.length, count);
  click(dom.get('history-close')); await flush();
  assert.equal(dom.calls.length, count + 1);
  assert.equal(dom.calls.at(-1).params.status, '4,7');
  assert.equal(dom.get('history-custom').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.document.activeElement, dom.get('history-custom'));
  click(dom.get('history-custom')); chooseStatuses(dom, ['2']);
  const event = dispatch(dom.get('history-status-options'), 'keydown', dom.document.activeElement, 'Escape');
  assert.equal(event.defaultPrevented, true); assert.equal(dom.calls.length, count + 1);
  assert.equal(dom.get('history-status-options').hidden, true);
  assert.deepEqual(dom.get('history-choices').children.filter(label => label.firstChild.checked).map(label => label.firstChild.value), ['4', '7']);
});

test('Custom commits on focus leaving, ignores unchanged closes, and rejects an empty selection locally', async t => {
  const dom = screen(t); await flush(); let count = dom.calls.length;
  click(dom.get('history-custom'));
  dispatch(dom.document, 'focusin', dom.get('history-limit')); await flush();
  assert.equal(dom.calls.length, count);
  click(dom.get('history-custom')); chooseStatuses(dom, ['4']);
  dispatch(dom.document, 'focusin', dom.get('history-limit')); await flush();
  assert.equal(dom.calls.length, ++count); assert.equal(dom.calls.at(-1).params.status, '4');
  click(dom.get('history-custom')); chooseStatuses(dom, []);
  dom.get('history-filters').dispatchEvent(new Event('submit')); await flush();
  assert.equal(dom.calls.length, count); assert.match(dom.get('history-notice').textContent, /at least one/);
  assert.equal(dom.get('history-status-options').hidden, true);
});

test('a preset consumes an open Custom draft without an intermediate request', async t => {
  const dom = screen(t); await flush(); const count = dom.calls.length;
  click(dom.get('history-custom')); chooseStatuses(dom, ['4', '7']);
  const running = dom.get('history-presets').children.find(button => button.dataset.historyPreset === 'running');
  assert.equal(dispatch(dom.document, 'pointerdown', running).defaultPrevented, true);
  click(running); dispatch(dom.document, 'click', running); await flush();
  assert.equal(dom.calls.length, count + 1); assert.equal(dom.calls.at(-1).params.status, '2');
  assert.equal(dom.document.activeElement, running); assert.equal(dom.get('history-status-options').hidden, true);
});

test('busy refresh preserves icon names/focus, and closing Custom cannot dispatch while busy', async t => {
  const wait = deferred(); let slow = false;
  const dom = screen(t, { response: () => runningDetailResponse('17'), read: () => slow ? wait.promise : historyPage() }); await flush();
  click(dom.get('history-custom')); chooseStatuses(dom, ['4']);
  const refresh = dom.get('detail-refresh'); refresh.focus(); slow = true; click(refresh); await flush();
  const count = dom.calls.length;
  assert.equal(refresh.getAttribute('aria-disabled'), 'true'); assert.equal(dom.document.activeElement, refresh);
  assert.equal(dom.get('detail-poll-toggle').getAttribute('aria-label'), 'Pause auto refresh');
  click(dom.get('history-close')); click(dom.get('history-custom'));
  assert.equal(dom.calls.length, count); assert.equal(dom.get('history-status-options').hidden, true);
  wait.resolve(historyPage()); await flush();
  assert.equal(refresh.getAttribute('aria-disabled'), 'false');
  click(dom.get('detail-poll-toggle'));
  assert.equal(dom.get('detail-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(dom.get('detail-poll-toggle').title, 'Resume auto refresh');
});

test('event drafts signal Search without requests; filters and errors occupy the existing meta line', async t => {
  let fail = false;
  const dom = screen(t, { tab: 'events', read: () => {
    if (fail) throw new ApiError('http', { status: 503, requestId });
    return eventPage();
  } }); await flush(); const count = dom.calls.length;
  const q = dom.get('events-q'), apply = dom.get('events-apply');
  assert.equal(dom.get('events-reset').hidden, true);
  q.value = 'literal %_'; q.dispatchEvent(new Event('input'));
  assert.equal(apply.className, 'button-primary'); assert.equal(dom.calls.length, count);
  dom.get('events-filters').dispatchEvent(new Event('submit')); await flush();
  assert.equal(dom.calls.length, count + 1); assert.equal(apply.className, '');
  assert.equal(dom.get('events-reset').hidden, false);
  fail = true; click(dom.get('detail-refresh')); await flush();
  assert.ok(dom.get('events-status').title.includes(requestId));
  assert.match(dom.get('events-status').textContent, /Previous event page shown/);
  assert.equal(dom.get('events-retry').hidden, false);
  assert.equal(dom.get('app-status').textContent, '');
});

for (const count of [1, 2]) test(`history caps the centered bar projection for ${count} execution(s)`, async t => {
  const dom = screen(t, { read: () => historyPage(Array.from({ length: count }, (_, i) => historyRow(String(count - i)))) });
  await flush(); const toggle = dom.get('history-chart-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  assert.equal(dom.get('history-chart-plot').style.maxWidth, `${count * 48}px`);
  assert.equal(dom.get('history-chart-x-axis').style.maxWidth, `${count * 48}px`);
  assert.equal(dom.get('history-chart-plot').children.filter(node => node.getAttribute('tabindex') === '0').length, 1);
  assert.equal(dom.calls.length, 2);
  click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  assert.equal(dom.calls.length, 2);
});

test('normal detail status titles include the refresh text once through pause and resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = screen(t, { response: () => runningDetailResponse('17') }); await flush();
  for (const [index, mode] of ['on', 'paused', 'on'].entries()) {
    const status = dom.get('detail-poll-status');
    assert.equal(status.textContent, `Updated 17:00:00 · auto refresh ${mode}`);
    assert.equal(status.title, `${status.textContent} · Observed 2026-10-17 17:00:00 · ${detailResponse().meta.generated_at}`);
    if (index < 2) { click(dom.get('detail-poll-toggle')); t.mock.timers.tick(0); await flush(); }
  }
  assert.equal(dom.calls.length, 4);
});

test('event count wording follows zero, one and many while preserving links, levels and focus', async t => {
  let count = 0;
  const dom = screen(t, { response: () => {
    const result = detailResponse('17');
    Object.assign(result.data, { warning_count: count, error_count: count });
    Object.assign(result.data.event_counts, { all: count * 2, errors: count, warnings: count,
      duplicate_warnings: 0, memory_warnings: 0 });
    return result;
  } });
  await flush();
  const link = dom.field('errors'); link.focus();
  for (count = 0; count <= 2; count++) {
    if (count) { click(dom.get('detail-refresh')); await flush(); }
    for (const key of ['errors', 'warnings']) {
      const label = count === 1 ? key.slice(0, -1) : key;
      assert.equal(dom.root.querySelector(`[data-event-count-label="${key}"]`).textContent, label);
      assert.equal(dom.field(key).textContent, String(count));
      assert.equal(dom.field(key).getAttribute('aria-label'), `${count} ${label} for this execution`);
      assert.equal(dom.field(key).href, `#events/${key}`);
      assert.equal(dom.field(key).dataset.level, count === 0 ? 'quiet' : key === 'errors' ? 'error' : 'warning');
    }
    assert.equal(dom.field('all').getAttribute('aria-label'), `${count * 2} events for this execution`);
    assert.equal(dom.field('errors'), link); assert.equal(dom.document.activeElement, link);
    assert.equal(dom.calls.length, (count + 1) * 2);
  }
});

test('the page reserves its scrollbar gutter and disclosure styles follow expanded state', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /:root\s*\{[^}]*scrollbar-gutter:\s*stable\s*;/);
  for (const key of ['history-chart', 'timeline']) {
    assert.ok(css.includes(`[data-${key}-toggle][aria-expanded="true"]`));
    assert.ok(!css.includes(`[data-${key}-toggle][aria-pressed=`));
  }
});

test('info tips work on hover/focus, fit the viewport, dismiss on Escape and remove listeners', () => {
  const document = Object.assign(new EventTarget(), { activeElement: null });
  const window = Object.assign(new EventTarget(), { innerWidth: 375, innerHeight: 900 });
  document.defaultView = window;
  const root = new Node(document, 'root'), container = new Node(document, 'span');
  const button = new Node(document, 'button'), tip = new Node(document, 'span', 'Definition');
  button.setAttribute('aria-describedby', 'definition');
  root.append(container); container.append(button, tip);
  button.getBoundingClientRect = () => ({ left: 340, top: 870, bottom: 890 });
  tip.getBoundingClientRect = () => ({ width: 330, height: 80 });
  document.getElementById = id => id === 'definition' ? tip : null;
  root.querySelectorAll = () => [button];
  const dispose = mountInfoTips(root);
  assert.equal(tip.hidden, true);
  container.dispatchEvent(new Event('pointerenter'));
  assert.equal(tip.hidden, false); assert.equal(tip.style.left, '37px'); assert.equal(tip.style.top, '784px');
  container.dispatchEvent(new Event('pointerleave')); assert.equal(tip.hidden, true);
  button.focus(); button.dispatchEvent(new Event('focus')); assert.equal(tip.hidden, false);
  dispatch(document, 'keydown', button, 'Escape'); assert.equal(tip.hidden, true);
  assert.equal(document.activeElement, button);
  dispose(); container.dispatchEvent(new Event('pointerenter')); assert.equal(tip.hidden, true);
});

test('native templates retain only row/timeline disclosures and one pager per toolbar', () => {
  const read = name => readFileSync(new URL(`../../dashboard/templates/app/${name}.html`, import.meta.url), 'utf8');
  const overview = read('index'), detail = read('execution').replace('{% include "app/history-panel.html" %}',
    read('history-panel')), controls = read('controls');
  assert.equal((overview.match(/<details/g) ?? []).length, 1); assert.match(overview, /<details data-timeline-values>/);
  assert.doesNotMatch(detail, /<details|data-history-chart-choice|data-history-direction|data-events-scope/);
  assert.equal((detail.match(/{{ pager\(/g) ?? []).length, 6);
  assert.match(controls, /class="info-trigger" aria-label="{{ label }}" aria-describedby="{{ id }}"/);
  assert.match(controls, /role="tooltip"/); assert.match(controls, /aria-hidden="true" focusable="false"/);
  assert.doesNotMatch(overview + detail, /resource-feedback|status-slot|table-footer|More sort options|How estimates work/);
});
