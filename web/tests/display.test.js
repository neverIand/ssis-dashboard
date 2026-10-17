import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisplay, formatBoolean, formatCode, formatId, formatText } from '../src/display.js';
import { wireTime } from './fixtures.js';

const display = createDisplay({ timeZone: 'Europe/London', locale: 'en-GB' });

test('BIGINT identities remain exact decimal strings', () => {
  for (const value of ['1', '9007199254740993', '9223372036854775807']) assert.equal(formatId(value), value);
  assert.equal(formatId(null), '—');
  for (const value of [9007199254740992, 42, '01', '0', '-1', '1e3', '9223372036854775808', undefined]) {
    assert.throws(() => formatId(value), TypeError);
  }
});

test('NULL, zero, false, empty strings and literal catalog text remain distinct', () => {
  assert.equal(display.count(null), '—');
  assert.equal(display.count(0), '0');
  assert.equal(display.count(9007199254740991), '9,007,199,254,740,991');
  assert.equal(formatBoolean(null), '—');
  assert.equal(formatBoolean(false), 'No');
  assert.equal(formatBoolean(true), 'Yes');
  assert.equal(formatText(null), '—');
  assert.equal(formatText(''), '');
  const text = '<img src=x onerror=alert(1)> 影狼 + / % _ all';
  assert.equal(formatText(text), text);
  for (const value of [false, '0', NaN, Infinity, -1, 9007199254740992]) {
    assert.throws(() => display.count(value), TypeError);
  }
  for (const value of [0, 'false', undefined]) assert.throws(() => formatBoolean(value), TypeError);
});

test('code labels use their supplied vocabulary and retain unknown numeric codes', () => {
  assert.equal(formatCode({ code: 0, name: 'none' }), 'None');
  assert.equal(formatCode({ code: 2, name: 'running' }), 'Running');
  assert.equal(formatCode({ code: 2, name: 'completion' }), 'Completion');
  assert.equal(formatCode({ code: -32768, name: 'unknown' }), 'Unknown (-32768)');
  assert.equal(formatCode({ code: 42, name: 'unknown' }), 'Unknown (42)');
  assert.equal(formatCode(null), '—');
  assert.equal(formatCode({ code: 9, name: '<b>literal</b>' }), '<b>literal</b>');
  assert.throws(() => formatCode({ code: '2', name: 'running' }), TypeError);
});

test('duration formatting does not invent a zero for NULL or a positive sub-millisecond value', () => {
  assert.equal(display.duration(null), '—');
  assert.equal(display.duration(0), '0 secs');
  assert.equal(display.duration(0.0000001), '<0.001 secs');
  assert.equal(display.duration(90061.125), '90,061.125 secs');
  for (const value of [-1, '1', false, NaN, Infinity]) assert.throws(() => display.duration(value), TypeError);
});

test('timezone projection is display-only, retains wire precision and distinguishes DST folds', () => {
  const row = { created_at: wireTime, from: '2026-10-17T16:00:00.0000001Z' };
  const original = JSON.stringify(row);
  const formatted = display.timestamp(row.created_at);
  assert.match(formatted, /17 Oct 2026/);
  assert.match(formatted, /17:00:00/);
  assert.equal(JSON.stringify(row), original);
  assert.equal(row.created_at, wireTime);
  assert.equal(display.timestamp(null), '—');
  const first = display.timestamp('2026-10-25T00:30:00.0000000Z');
  const second = display.timestamp('2026-10-25T01:30:00.0000000Z');
  assert.match(first, /01:30:00/);
  assert.match(second, /01:30:00/);
  assert.notEqual(first, second);
  for (const value of ['2026-02-30T00:00:00.0000000Z', '2026-10-17T16:00:00', 0, 'invalid']) {
    assert.throws(() => display.timestamp(value), TypeError);
  }
  assert.throws(() => createDisplay({ timeZone: 'invalid/zone' }), RangeError);
  assert.throws(() => createDisplay(), TypeError);
});
