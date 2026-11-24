import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSkipLink, breakableText, mountInfoTips, positionPopover } from '../src/ui.js';
import { Node, overviewDOM } from './overview-dom.js';
import { installPopover } from './popover-dom.js';

test('the skip link focuses the main region without following its fragment, and stops after dispose', () => {
  const document = { activeElement: null };
  const root = new Node(document, 'root'), link = new Node(document, 'a'), main = new Node(document, 'main');
  root.ownerDocument = document; root.append(link, main);
  root.querySelector = selector => selector === '.skip-link' ? link : null;
  document.getElementById = id => id === 'main-content' ? main : null;
  const dispose = mountSkipLink(root);
  const click = new Event('click', { cancelable: true });
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'no fragment navigation');
  assert.equal(document.activeElement, main);
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    const modified = new Event('click', { cancelable: true }); Object.defineProperty(modified, key, { value: true });
    document.activeElement = null; link.dispatchEvent(modified);
    assert.equal(modified.defaultPrevented, false, key); assert.equal(document.activeElement, null, key);
  }
  dispose(); document.activeElement = null;
  const later = new Event('click', { cancelable: true });
  link.dispatchEvent(later);
  assert.equal(later.defaultPrevented, false);
  assert.equal(document.activeElement, null);
});

test('a page without a skip link or main region mounts nothing', () => {
  const document = { getElementById: () => null };
  const root = new Node(document, 'root');
  root.querySelector = () => null;
  assert.equal(typeof mountSkipLink(root), 'function');
});

test('O9: names get break opportunities after separators while their text stays identical', () => {
  const dom = overviewDOM(), node = dom.document.createElement('a');
  breakableText(node, 'Load_Fact_Sales.dtsx');
  assert.equal(node.textContent, 'Load_Fact_Sales.dtsx');
  assert.deepEqual(node.children.map(child => child.tag), ['#text', 'wbr', '#text', 'wbr', '#text', 'wbr', '#text']);
  const before = [...node.children];
  breakableText(node, 'Load_Fact_Sales.dtsx');
  assert.deepEqual(node.children, before, 'unchanged names keep their nodes');
  breakableText(node, 'Probe');
  assert.equal(node.textContent, 'Probe');
  assert.equal(node.children.length, 1);
});

function dispatch(node, type, target, key) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  if (key) Object.defineProperty(event, 'key', { value: key });
  node.dispatchEvent(event); return event;
}

test('a restored popover stays visible after its trigger scrolls beyond either viewport edge (F001)', () => {
  const document = { documentElement: { clientWidth: 360, clientHeight: 812 } };
  const panel = { ownerDocument: document, style: {}, getBoundingClientRect: () => ({ width: 340, height: 474 }) };
  for (const [anchor, top] of [
    [{ left: 40, top: -370, bottom: -334 }, '8px'],
    [{ left: 40, top: 1000, bottom: 1036 }, '330px']
  ]) {
    positionPopover(panel, { getBoundingClientRect: () => anchor });
    assert.equal(panel.style.left, '12px');
    assert.equal(panel.style.top, top);
  }
});

test('info tips work on hover/focus, fit beside the viewport scrollbar, dismiss on Escape and remove listeners', () => {
  const document = Object.assign(new EventTarget(), { activeElement: null,
    documentElement: { clientWidth: 360, clientHeight: 900 } });
  const window = Object.assign(new EventTarget(), { innerWidth: 375, innerHeight: 900 });
  document.defaultView = window;
  const root = new Node(document, 'root'), container = new Node(document, 'span');
  const button = new Node(document, 'button'), tip = new Node(document, 'span', 'Definition');
  installPopover(tip);
  button.setAttribute('aria-describedby', 'definition');
  root.append(container); container.append(button, tip);
  button.getBoundingClientRect = () => ({ left: 340, top: 870, bottom: 890 });
  tip.getBoundingClientRect = () => ({ width: 330, height: 80 });
  document.getElementById = id => id === 'definition' ? tip : null;
  root.querySelectorAll = () => [button];
  const dispose = mountInfoTips(root);
  assert.equal(tip.matches(':popover-open'), false);
  container.dispatchEvent(new Event('pointerenter'));
  assert.equal(tip.matches(':popover-open'), true); assert.equal(tip.style.left, '22px'); assert.equal(tip.style.top, '784px');
  container.dispatchEvent(new Event('pointerleave')); assert.equal(tip.matches(':popover-open'), false);
  button.focus(); button.dispatchEvent(new Event('focus')); assert.equal(tip.matches(':popover-open'), true);
  dispatch(document, 'keydown', button, 'Escape'); assert.equal(tip.matches(':popover-open'), false);
  assert.equal(document.activeElement, button);
  dispose(); container.dispatchEvent(new Event('pointerenter')); assert.equal(tip.matches(':popover-open'), false);
});
