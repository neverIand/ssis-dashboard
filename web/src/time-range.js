import { createdPresets, presetHours, SelectionError, timestampTicks } from './selection.js';

const epochTicks = timestampTicks('1970-01-01T00:00:00Z');
const pad = value => String(value).padStart(2, '0');
const formatters = new Map();
const repeatedDates = new Map();

// `iso` gives signed ISO years for date arithmetic just outside 0001–9999 (1 BC is 0000, 10000 is +010000).
// Displayed and edited dates keep the unsigned year, at least four digits, as before.
function parts(date, timeZone, iso = false) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23', calendar: 'gregory', numberingSystem: 'latn', era: 'short',
  }));
  const values = Object.fromEntries(formatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]));
  const year = values.era === 'BC' ? 1 - Number(values.year) : Number(values.year);
  const text = !iso ? values.year.padStart(4, '0') : year < 0 ? `-${String(-year).padStart(6, '0')}`
    : year > 9999 ? `+${String(year).padStart(6, '0')}` : String(year).padStart(4, '0');
  return { date: `${text}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:${values.second}` };
}

export function projectTime(value, timeZone, iso = false) {
  const ticks = timestampTicks(value);
  const milliseconds = Number((ticks - epochTicks) / 10000n);
  // Floor negative instants too; projection never replaces the original wire value.
  return parts(new Date(milliseconds - (ticks < epochTicks && (ticks - epochTicks) % 10000n ? 1 : 0)), timeZone, iso);
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
    const local = parts(sample, timeZone, true);
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
    const local = parts(instant, timeZone, true);
    if (local.date === date && local.time === clock.slice(0, 8)) {
      const value = instant.toISOString().slice(0, 19) + (clock.includes('.') ? `.${clock.split('.')[1]}` : '') + 'Z';
      timestampTicks(value);
      matches.push({ value,
        offset: `UTC${offset < 0 ? '−'
          : '+'}${pad(Math.floor(Math.abs(offset) / 3600000))}:${pad(Math.floor(Math.abs(offset) / 60000) % 60)}` });
    }
  }
  return matches.sort((a, b) => a.value.localeCompare(b.value));
}

// The first instant whose local date is `date` or later, as the API's day buckets choose a day's start: the earlier
// of a repeated midnight, or the clock change itself when midnight is skipped (America/Santiago on 6 September 2026
// starts at 01:00). A date skipped entirely (Pacific/Apia, 30 December 2011) resolves to the next day's start.
const dateValue = date => Date.parse(`${date}T00:00:00Z`);
function dateBoundary(date, timeZone) {
  const midnight = localCandidates(date, '00:00:00', timeZone);
  if (midnight.length) return { value: midnight[0].value, date };
  // Search the 26 hours before the earliest instant at or after the date for the instant the date changes.
  const wall = Date.parse(`${date}T00:00:00Z`);
  let late = Math.min(...[...nearbyOffsets(wall, timeZone)].map(offset => wall - offset)
    .filter(instant => dateValue(parts(new Date(instant), timeZone, true).date) >= wall));
  if (!Number.isFinite(late)) throw new SelectionError('The start of this day is unavailable. Choose another date.');
  let early = late - 26 * 3600000;
  while (late - early > 1) {
    const middle = Math.floor((early + late) / 2);
    if (dateValue(parts(new Date(middle), timeZone, true).date) < wall) early = middle; else late = middle;
  }
  const value = new Date(late).toISOString().replace(/\.000Z$/, 'Z');
  timestampTicks(value);
  return { value, date: parts(new Date(late), timeZone, true).date };
}

export function dayStart(date, timeZone) {
  const boundary = dateBoundary(date, timeZone);
  if (boundary.date !== date) throw new SelectionError('This date was skipped by a time zone change. Choose another date.');
  return boundary.value;
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
  // An inclusive end date runs to the next day's start, even when the next date itself was skipped.
  if (!includeTime) return end ? dateBoundary(nextDate(date), timeZone).value : dayStart(date, timeZone);
  const candidates = localCandidates(date, time, timeZone);
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
    try {
      return { from: dayStart(projectTime(serverTime, timeZone, true).date, timeZone), to: serverTime };
    } catch { throw new SelectionError('The start of today is unavailable. Choose a custom range.'); }
  }
  const hours = presetHours[preset];
  if (!hours) throw new SelectionError('Choose a creation window.');
  const from = now - BigInt(hours) * 36000000000n;
  const fraction = from % 10000000n;
  const seconds = (from - epochTicks - fraction) / 10000000n;
  const value = new Date(Number(seconds) * 1000).toISOString().slice(0, 19) + `.${String(fraction).padStart(7, '0')}Z`;
  timestampTicks(value);
  return { from: value, to: serverTime };
}

// Advance a server observation with elapsed monotonic time, never the wall clock.
export function createServerClock(serverTime, now = () => performance.now()) {
  let anchor = null, observed = 0;
  const observe = value => { anchor = timestampTicks(value); observed = now(); };
  if (serverTime) observe(serverTime);
  return {
    observe,
    read() {
      if (anchor === null) throw new SelectionError('Server time is unavailable. Reload settings to retry.');
      const ticks = anchor + BigInt(Math.floor(Math.max(0, now() - observed) * 10000));
      const fraction = ticks % 10000000n;
      const seconds = (ticks - epochTicks - fraction) / 10000000n;
      return new Date(Number(seconds) * 1000).toISOString().slice(0, 19)
        + `.${String(fraction).padStart(7, '0')}Z`;
    },
  };
}

export const defaultRangePreset = hours => Object.keys(presetHours).find(key => presetHours[key] === hours) ?? null;

export function rangeLabel(selection, timeZone, defaultHours = 24) {
  if (selection.created) return createdPresets[selection.created];
  if (selection.from === null && selection.to === null) {
    return createdPresets[defaultRangePreset(defaultHours)]
      ?? `Last ${defaultHours % 24 === 0 ? `${defaultHours / 24} days` : `${defaultHours} hours`}`;
  }
  const label = value => {
    if (value === null) return 'Default';
    const local = projectTime(value, timeZone);
    const offset = repeatedTimeOffset(value, timeZone, local);
    return `${local.date} ${local.time}${offset ? ` (${offset})` : ''}`;
  };
  return `${label(selection.from)} → ${label(selection.to)}`;
}
