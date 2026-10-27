import assert from 'node:assert/strict';
import test from 'node:test';
import { mountServerLabel } from '../src/bootstrap.js';
import { deferred } from './fixtures.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('server label renders literal text once and disposes its owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = {}, calls = [];
  const dispose = mountServerLabel(node, { async get(resource, options) {
    calls.push({ resource, ...options }); return { data: { server_name: '<b>literal server</b>' } };
  } });
  await settle();
  assert.equal(node.textContent, '<b>literal server</b>');
  assert.equal(node.title, node.textContent);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resource, 'server');
  dispose();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(node.hidden, true);
  assert.equal(node.textContent, '');
});

test('unavailable or malformed label has no automatic retry and does not throw into screen startup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reply of [null, 'x'.repeat(129), undefined]) {
    const node = {}; let calls = 0;
    const dispose = mountServerLabel(node, { async get() {
      calls += 1;
      if (reply === undefined) throw new Error('private-error');
      return { data: { server_name: reply } };
    } });
    await settle();
    assert.equal(node.textContent, 'Server unavailable');
    t.mock.timers.tick(60000); await settle();
    assert.equal(calls, 1);
    dispose();
  }
});

test('deadline abort and disposal both reject late labels when a transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['timeout', 'dispose']) {
    const node = {}, late = deferred(); let signal;
    const dispose = mountServerLabel(node, { get(resource, options) { signal = options.signal; return late.promise; } });
    if (action === 'timeout') t.mock.timers.tick(10000);
    else dispose();
    assert.equal(signal.aborted, true);
    const current = node.textContent;
    late.resolve({ data: { server_name: 'retired server' } }); await settle();
    assert.equal(node.textContent, current);
    dispose();
  }
});
