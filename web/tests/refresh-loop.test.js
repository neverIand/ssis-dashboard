import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshLoop } from '../src/refresh-loop.js';

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0;
  const loop = createRefreshLoop({ publish: () => {}, ...options, refresh() {
    calls += 1;
    loop.update({ busy: true, eligible: true });
  } });
  t.after(() => loop.dispose());
  const start = () => loop.update({ busy: true, eligible: true });
  const finish = (changes = {}) => loop.update({ busy: false, eligible: true, ...changes });
  return { loop, start, finish, get calls() { return calls; } };
}

test('one poll waits at least 30 seconds after completion and never overlaps slow work', t => {
  const run = setup(t);
  run.start();
  t.mock.timers.tick(20);
  run.finish();
  assert.equal(run.loop.snapshot().nextAt, 30020);
  t.mock.timers.tick(29999);
  assert.equal(run.calls, 0);
  t.mock.timers.tick(1);
  assert.equal(run.calls, 1);
  assert.equal(run.loop.snapshot().nextAt, null);
  t.mock.timers.tick(600000);
  assert.equal(run.calls, 1);
  run.finish();
  assert.equal(run.loop.snapshot().delayMs, 300000);
});

test('observed cycle cost extends the interval and unrelated state updates do not postpone it', t => {
  const run = setup(t);
  run.start();
  t.mock.timers.tick(8000);
  run.finish();
  assert.equal(run.loop.snapshot().delayMs, 40000);
  assert.equal(run.loop.snapshot().nextAt, 48000);
  t.mock.timers.tick(10000);
  run.finish();
  assert.equal(run.loop.snapshot().nextAt, 48000);
  t.mock.timers.tick(30000);
  assert.equal(run.calls, 1);
});

test('transient failures back off to five minutes and success resets the interval', t => {
  const run = setup(t);
  run.start();
  for (const delay of [30000, 60000, 120000, 240000, 300000, 300000]) {
    run.finish({ failed: true });
    assert.equal(run.loop.snapshot().delayMs, delay);
    t.mock.timers.tick(delay);
  }
  assert.equal(run.calls, 6);
  run.finish();
  assert.equal(run.loop.snapshot().failures, 0);
  assert.equal(run.loop.snapshot().delayMs, 30000);
});

test('nonretryable failures stop automatic work, including visibility return; manual success recovers', t => {
  const run = setup(t);
  run.start();
  run.finish({ failed: true, retryable: false });
  assert.equal(run.loop.snapshot().mode, 'blocked');
  run.loop.setVisible(false);
  run.loop.setVisible(true);
  t.mock.timers.tick(600000);
  assert.equal(run.calls, 0);
  run.start();
  run.finish();
  assert.equal(run.loop.snapshot().mode, 'scheduled');
});

test('starting manual work replaces the pending poll and schedules from its completion', t => {
  const run = setup(t);
  run.start();
  run.finish();
  t.mock.timers.tick(15000);
  run.start();
  t.mock.timers.tick(10000);
  assert.equal(run.calls, 0);
  run.finish();
  assert.equal(run.loop.snapshot().nextAt, 75000);
  t.mock.timers.tick(49999);
  assert.equal(run.calls, 0);
  t.mock.timers.tick(1);
  assert.equal(run.calls, 1);
});

test('hidden tabs have no timer and return performs exactly one immediate resync', t => {
  const run = setup(t);
  run.start();
  run.finish();
  run.loop.setVisible(false);
  assert.equal(run.loop.snapshot().mode, 'hidden');
  t.mock.timers.tick(900000);
  assert.equal(run.calls, 0);
  run.loop.setVisible(true);
  run.loop.setVisible(true);
  t.mock.timers.tick(0);
  assert.equal(run.calls, 1);
  run.finish();
  t.mock.timers.tick(0);
  assert.equal(run.calls, 1);
  assert.equal(run.loop.snapshot().nextAt, 930000);
});

test('return during an active cycle queues one resync after it, without overlapping', t => {
  const run = setup(t);
  run.start();
  run.loop.setVisible(false);
  t.mock.timers.tick(1000);
  run.loop.setVisible(true);
  run.loop.setVisible(true);
  t.mock.timers.tick(1000);
  assert.equal(run.calls, 0);
  run.finish();
  t.mock.timers.tick(0);
  assert.equal(run.calls, 1);
  run.finish();
  t.mock.timers.tick(0);
  assert.equal(run.calls, 1);
});

test('user pause survives hidden return and manual cycles; resume coalesces with active work', t => {
  const run = setup(t);
  run.start();
  run.loop.setPaused(true);
  run.finish();
  run.loop.setVisible(false);
  run.loop.setVisible(true);
  t.mock.timers.tick(900000);
  assert.equal(run.calls, 0);
  assert.equal(run.loop.snapshot().mode, 'paused');
  run.start();
  run.loop.setPaused(false);
  t.mock.timers.tick(0);
  assert.equal(run.calls, 0);
  run.finish();
  assert.equal(run.loop.snapshot().nextAt, 930000);
});

test('reset retains user pause, invalid selection cancels work, and disposal prevents future callbacks', t => {
  const run = setup(t);
  run.start();
  run.finish();
  run.loop.setPaused(true);
  run.loop.reset();
  assert.equal(run.loop.snapshot().paused, true);
  run.loop.setPaused(false);
  run.loop.update({ busy: false, eligible: false });
  t.mock.timers.tick(60000);
  assert.equal(run.calls, 0);
  run.start();
  run.finish();
  run.loop.dispose();
  run.loop.dispose();
  run.loop.setVisible(false);
  run.loop.setVisible(true);
  run.loop.setPaused(true);
  run.loop.setPaused(false);
  t.mock.timers.tick(900000);
  assert.equal(run.calls, 0);
});
