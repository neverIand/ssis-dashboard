import { SelectionError, timestampTicks } from './selection.js';

const epochTicks = timestampTicks('1970-01-01T00:00:00Z');
const pad = value => String(value).padStart(2, '0');
const formatters = new Map();
const repeatedDates = new Map();

function parts(date, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23', calendar: 'gregory', numberingSystem: 'latn',
  }));
  const values = Object.fromEntries(formatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${values.year.padStart(4, '0')}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}` };
}

export function projectTime(value, timeZone) {
  const ticks = timestampTicks(value);
  const milliseconds = Number((ticks - epochTicks) / 10000n);
  // Floor negative instants too; projection never replaces the original wire value.
  return parts(new Date(milliseconds - (ticks < epochTicks && (ticks - epochTicks) % 10000n ? 1 : 0)), timeZone);
}

export function nextDate(value) {
  timestampTicks(`${value}T00:00:00Z`);
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new SelectionError('Choose an end date before 31 December 9999.');
  return result;
}

function nearbyOffsets(wall, timeZone) {
  const offsets = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(wall + hours * 3600000);
    const local = parts(sample, timeZone);
    offsets.add(Date.parse(`${local.date}T${local.time}Z`) - Math.floor(sample.valueOf() / 1000) * 1000);
  }
  return offsets;
}

// Enumerate the actual instants for a wall time. Zero = DST gap; two = repeated time.
// Date is used to resolve a new user choice only, never to round restored bounds.
export function localCandidates(date, time, timeZone) {
  if (!date) return [];
  const clock = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  timestampTicks(`${date}T${clock}Z`);
  const wall = Date.parse(`${date}T${clock}Z`);
  const offsets = nearbyOffsets(wall, timeZone);
  const matches = [];
  for (const offset of offsets) {
    const instant = new Date(wall - offset);
    const local = parts(instant, timeZone);
    if (local.date === date && local.time === clock.slice(0, 8)) {
      const value = instant.toISOString().slice(0, 19) + (clock.includes('.') ? `.${clock.split('.')[1]}` : '') + 'Z';
      timestampTicks(value);
      matches.push({ value, offset: `UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(offset) / 3600000))}:${pad(Math.floor(Math.abs(offset) / 60000) % 60)}` });
    }
  }
  return matches.sort((a, b) => a.value.localeCompare(b.value));
}

export function repeatedTimeOffset(value, timeZone, local = projectTime(value, timeZone)) {
  const key = `${timeZone}/${local.date}`;
  if (!repeatedDates.has(key)) {
    // Cache only a bounded date/zone flag, never execution timestamps or values.
    if (repeatedDates.size >= 32) repeatedDates.delete(repeatedDates.keys().next().value);
    repeatedDates.set(key, nearbyOffsets(Date.parse(`${local.date}T12:00:00Z`), timeZone).size > 1);
  }
  if (!repeatedDates.get(key)) return '';
  const candidates = localCandidates(local.date, local.time, timeZone);
  if (candidates.length < 2) return '';
  const seconds = timestampTicks(value) / 10000000n;
  return candidates.find(candidate => timestampTicks(candidate.value) / 10000000n === seconds).offset.replace('−', '-');
}

export function calendarBound(date, time, timeZone, { end = false, includeTime = false, occurrence = '' } = {}) {
  if (!date) return null;
  const candidates = localCandidates(end && !includeTime ? nextDate(date) : date,
    includeTime ? time : '00:00:00', timeZone);
  if (!candidates.length) throw new SelectionError('This local time is skipped by the clock change. Choose another time.');
  if (candidates.length > 1 && occurrence === '') {
    throw new SelectionError('This local time occurs twice. Choose the first or second occurrence.');
  }
  const selected = candidates[candidates.length === 1 ? 0 : Number(occurrence)];
  if (!selected) throw new SelectionError('Choose a valid time occurrence.');
  return selected.value;
}

export function presetRange(preset, serverTime, timeZone) {
  const now = timestampTicks(serverTime);
  if (preset === 'today') {
    const { date } = projectTime(serverTime, timeZone);
    const candidates = localCandidates(date, '00:00:00', timeZone);
    if (!candidates.length) throw new SelectionError('The start of today is unavailable. Choose a custom range.');
    return { from: candidates[0].value, to: serverTime };
  }
  const hours = { '24h': 24, '7d': 168, '30d': 720 }[preset];
  if (!hours) throw new SelectionError('Choose a creation window.');
  const from = now - BigInt(hours) * 36000000000n;
  const fraction = from % 10000000n;
  const seconds = (from - epochTicks - fraction) / 10000000n;
  const value = new Date(Number(seconds) * 1000).toISOString().slice(0, 19) + `.${String(fraction).padStart(7, '0')}Z`;
  timestampTicks(value);
  return { from: value, to: serverTime };
}

export function rangeLabel(selection, timeZone) {
  if (selection.from === null && selection.to === null) return 'Default window';
  const label = value => {
    if (value === null) return 'Default';
    const local = projectTime(value, timeZone);
    const offset = repeatedTimeOffset(value, timeZone, local);
    return `${local.date} ${local.time}${offset ? ` (${offset})` : ''}`;
  };
  return `${label(selection.from)} → ${label(selection.to)}`;
}
