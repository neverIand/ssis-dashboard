import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarBound, localCandidates, nextDate, presetRange, projectTime, rangeLabel } from '../src/time-range.js';
import { timestampTicks } from '../src/selection.js';

test('creation range labels retain seconds in the fixed display-zone format', () => {
  assert.equal(rangeLabel({from:'2026-10-17T16:00:01.1234567Z',to:'2026-10-17T17:30:02Z'}, 'Europe/London'),
    '2026-10-17 17:00:01 → 2026-10-17 18:30:02');
  assert.equal(rangeLabel({from:null,to:null}, 'Europe/London'), 'Default window');
});

test('creation range labels distinguish repeated wall times from UTC or offset bounds', () => {
  const expected = '2026-10-25 01:30:00 (UTC+01:00) → 2026-10-25 01:30:00 (UTC+00:00)';
  assert.equal(rangeLabel({from:'2026-10-25T00:30:00.1234567Z',to:'2026-10-25T01:30:00.9876543Z'}, 'Europe/London'), expected);
  assert.equal(rangeLabel({from:'2026-10-25T01:30:00+01:00',to:'2026-10-25T01:30:00+00:00'}, 'Europe/London'), expected);
  assert.equal(rangeLabel({from:null,to:'2026-10-25T02:00:00Z'}, 'Europe/London'), 'Default → 2026-10-25 02:00:00');
});

test('calendar dates use London summer/winter time, including 23/25-hour days', () => {
  for (const [date, hours] of [['2026-03-29', 23], ['2026-10-25', 25]]) {
    const from = calendarBound(date, '', 'Europe/London');
    const to = calendarBound(date, '', 'Europe/London', { end: true });
    assert.equal((timestampTicks(to) - timestampTicks(from)) / 36000000000n, BigInt(hours));
  }
  assert.equal(calendarBound('2026-07-01', '', 'Asia/Tokyo'), '2026-06-30T15:00:00Z');
  assert.equal(calendarBound('', '', 'Europe/London'), null);
});

test('gaps reject, repeated times resolve only with an explicit occurrence, including half-hour shifts', () => {
  assert.equal(localCandidates('2026-03-29', '01:30', 'Europe/London').length, 0);
  assert.throws(() => calendarBound('2026-03-29', '01:30', 'Europe/London', { includeTime: true }), /skipped/);
  assert.throws(() => calendarBound('2026-10-25', '01:30', 'Europe/London', { includeTime: true }), /twice/);
  assert.deepEqual(localCandidates('2026-10-25', '01:30', 'Europe/London').map(row => row.value), ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']);
  const halfHour = localCandidates('2026-04-05', '01:45', 'Australia/Lord_Howe');
  assert.equal(halfHour.length, 2);
  assert.equal(timestampTicks(halfHour[1].value) - timestampTicks(halfHour[0].value), 18000000000n);
});

test('projection handles precise instants before 1970 and year boundaries without modifying the wire value', () => {
  assert.deepEqual(projectTime('1969-12-31T23:59:59.9999999Z', 'UTC'), { date: '1969-12-31', time: '23:59:59' });
  assert.equal(projectTime('2026-12-31T23:59:59.9999999Z', 'Asia/Tokyo').date, '2027-01-01');
  assert.equal(nextDate('2024-02-28'), '2024-02-29');
  assert.throws(() => nextDate('2026-02-29'));
  assert.throws(() => nextDate('9999-12-31'));
});

test('relative presets use the supplied server instant, keep 100ns precision and respect local today', () => {
  const now = '2026-10-25T10:00:00.1234567Z';
  assert.deepEqual(presetRange('24h', now, 'Europe/London'), { from: '2026-10-24T10:00:00.1234567Z', to: now });
  assert.equal(presetRange('today', now, 'Europe/London').from, '2026-10-24T23:00:00Z');
  assert.equal(presetRange('7d', '1969-12-31T23:59:59.1234567Z', 'UTC').from, '1969-12-24T23:59:59.1234567Z');
  assert.throws(() => presetRange('bad', now, 'UTC'));
});
