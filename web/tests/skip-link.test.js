import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSkipLink } from '../src/ui.js';
import { Node } from './overview-dom.js';

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
