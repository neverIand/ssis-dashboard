import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisplay, formatBoolean, formatCode, formatId, formatText, refreshStatus } from '../src/display.js';
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
  assert.equal(display.duration(0), '0 ms');
  assert.equal(display.duration(0.0000001), '<1 ms');
  assert.equal(display.duration(90061.125), '25 h 01 min');
  for (const value of [-1, '1', false, NaN, Infinity]) assert.throws(() => display.duration(value), TypeError);
});

test('fixed timezone projection retains wire precision; repeated local times keep their exact wire identity', () => {
  const row = { created_at: wireTime, from: '2026-10-17T16:00:00.0000001Z' };
  const original = JSON.stringify(row);
  const formatted = display.timestamp(row.created_at);
  assert.equal(formatted, '2026-10-17 17:00:00');
  assert.equal(JSON.stringify(row), original);
  assert.equal(row.created_at, wireTime);
  assert.equal(display.timestamp(null), '—');
  const first = display.timestamp('2026-10-25T00:30:00.0000000Z');
  const second = display.timestamp('2026-10-25T01:30:00.0000000Z');
  assert.equal(first, '2026-10-25 01:30:00 (UTC+01:00)');
  assert.equal(second, '2026-10-25 01:30:00 (UTC+00:00)');
  for (const value of ['2026-02-30T00:00:00.0000000Z', '2026-10-17T16:00:00', 0, 'invalid']) {
    assert.throws(() => display.timestamp(value), TypeError);
  }
  assert.throws(() => createDisplay({ timeZone: 'invalid/zone' }), RangeError);
  assert.throws(() => createDisplay(), TypeError);
});

test('every time formatter distinguishes both fold occurrences, including half-hour and negative offsets', () => {
  for (const [zone, first, second, day, clock, offsets] of [
    ['Europe/London', '2026-10-25T00:30:00.1234567Z', '2026-10-25T01:30:00.1234567Z', '2026-10-25', '01:30:00', ['UTC+01:00', 'UTC+00:00']],
    ['America/New_York', '2026-11-01T05:30:00.1234567Z', '2026-11-01T06:30:00.1234567Z', '2026-11-01', '01:30:00', ['UTC-04:00', 'UTC-05:00']],
    ['Australia/Lord_Howe', '2026-04-04T14:45:00.1234567Z', '2026-04-04T15:15:00.1234567Z', '2026-04-05', '01:45:00', ['UTC+11:00', 'UTC+10:30']],
  ]) {
    const d = createDisplay({timeZone:zone});
    for (const [index, value] of [first, second].entries()) {
      const suffix = ` (${offsets[index]})`;
      assert.equal(d.timestamp(value), `${day} ${clock}${suffix}`);
      assert.equal(d.clock(value), `${clock}${suffix}`);
      assert.equal(d.tableTimestamp(value, first), `${clock}.123${suffix}`);
      assert.equal(d.tableTimestamp(value, null), `${day} ${clock}.123${suffix}`);
    }
  }
  for (const [value, expected] of [
    ['2026-10-24T23:59:59.9999999Z', '2026-10-25 00:59:59'],
    ['2026-10-25T02:00:00.0000000Z', '2026-10-25 02:00:00'],
    ['2026-03-29T00:30:00.0000000Z', '2026-03-29 00:30:00'],
    ['2026-03-29T01:30:00.0000000Z', '2026-03-29 02:30:00'],
  ]) assert.equal(display.timestamp(value), expected);
  assert.equal(display.clock(null), '—');
  assert.equal(display.clock(wireTime), '17:00:00');
});

test('durations use readable units and carry rounding across unit boundaries', () => {
  for (const [seconds, text] of [[0.001, '1 ms'], [0.85, '850 ms'], [0.9996, '1 s'],
    [1, '1 s'], [4.56, '4.6 s'], [59.94, '59.9 s'], [59.99, '1 min 00 s'],
    [65.255, '1 min 05 s'], [3599.9, '1 h 00 min'], [7380, '2 h 03 min']]) {
    assert.equal(display.duration(seconds), text);
  }
});

test('detail table times compare display-zone dates and preserve milliseconds without rounding the day', () => {
  const start = '2026-10-17T23:05:00.1234567Z'; // 18 October in London.
  assert.equal(display.tableTimestamp(start, start), '00:05:00.123');
  assert.equal(display.tableTimestamp('2026-10-18T22:59:59.9999999Z', start), '23:59:59.999');
  assert.equal(display.tableTimestamp('2026-10-18T23:00:00.0000001Z', start), '2026-10-19 00:00:00.000');
  assert.equal(display.tableTimestamp(wireTime, null), '2026-10-17 17:00:00.123');
  assert.equal(display.tableTimestamp(null, start), '—');
  assert.equal(display.timestamp('2026-01-01T00:00:00.0000000Z'), '2026-01-01 00:00:00');
  const east = createDisplay({timeZone: 'Asia/Kolkata'});
  assert.equal(east.timestamp(wireTime), '2026-10-17 21:30:00');
});

test('display text is independent of zh-CN and non-Latin default locales', t => {
  // Windows Node ignores LANG/LC_ALL. Simulate each host's default explicitly.
  const DateTimeFormat = Intl.DateTimeFormat, NumberFormat = Intl.NumberFormat;
  for (const locale of ['en-GB', 'zh-CN', 'ar-EG']) {
    const dates = t.mock.method(Intl, 'DateTimeFormat', function(locales, options) {
      return new DateTimeFormat(locales ?? locale, options);
    });
    const numbers = t.mock.method(Intl, 'NumberFormat', function(locales, options) {
      return new NumberFormat(locales ?? locale, options);
    });
    assert.equal(Intl.DateTimeFormat().resolvedOptions().locale, locale);
    const d = createDisplay({timeZone:'Europe/London'});
    assert.deepEqual([d.timestamp(wireTime), d.tableTimestamp(wireTime, wireTime), d.duration(65.255), d.count(12345)],
      ['2026-10-17 17:00:00', '17:00:00.123', '1 min 05 s', '12,345']);
    assert.equal(d.clock('2026-10-25T01:30:00.0000000Z'), '01:30:00 (UTC+00:00)');
    dates.mock.restore(); numbers.mock.restore();
  }
});

test('one refresh indicator keeps the last observation and distinguishes paused, hidden, retry and stopped states', () => {
  for (const [mode, failures, text] of [['scheduled', 0, 'auto refresh on'], ['scheduled', 1, 'retry scheduled'],
    ['paused', 0, 'auto refresh paused'], ['hidden', 0, 'auto refresh paused (tab hidden)'],
    ['updating', 0, 'refreshing…'], ['blocked', 0, 'auto refresh stopped']]) {
    assert.equal(refreshStatus(display, wireTime, {mode, failures}), `Updated 17:00:00 · ${text}`);
  }
  assert.equal(refreshStatus(display, null, {mode:'idle'}), '');
  assert.equal(refreshStatus(display, null, {mode:'updating'}), 'Refreshing…');
  assert.equal(refreshStatus(display, null, {mode:'paused'}), 'Auto refresh paused');
});
