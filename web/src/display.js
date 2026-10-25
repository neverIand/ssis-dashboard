import { repeatedTimeOffset } from './time-range.js';

const missing = '—';
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;

export function formatId(value) {
  if (value === null) return missing;
  if (typeof value !== 'string' || value.length > 19 || !/^[1-9]\d*$/.test(value)
      || BigInt(value) > 9223372036854775807n) {
    throw new TypeError('Invalid execution ID.');
  }
  return value;
}

export function formatText(value) {
  if (value === null) return missing;
  if (typeof value !== 'string') throw new TypeError('Invalid text.');
  return value;
}

export function formatBoolean(value) {
  if (value === null) return missing;
  if (typeof value !== 'boolean') throw new TypeError('Invalid boolean.');
  return value ? 'Yes' : 'No';
}

export function formatCode(value) {
  if (value === null) return missing;
  if (!Number.isSafeInteger(value?.code) || typeof value.name !== 'string' || !value.name) {
    throw new TypeError('Invalid catalog code.');
  }
  if (value.name === 'unknown') return `Unknown (${value.code})`;
  const name = value.name.replaceAll(/[_-]/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createDisplay({ timeZone } = {}) {
  if (typeof timeZone !== 'string' || !timeZone) throw new TypeError('A display timezone is required.');
  const counts = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const timestamps = new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  });
  function parts(value) {
    if (typeof value !== 'string' || !timestampPattern.test(value)) throw new TypeError('Invalid wire timestamp.');
    // Date/Intl is a display-only projection. Callers retain all seven wire digits.
    const date = new Date(value.slice(0, 23) + 'Z');
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new TypeError('Invalid wire timestamp.');
    }
    const p = Object.fromEntries(timestamps.formatToParts(date).map(part => [part.type, part.value]));
    const day = `${p.year.padStart(4, '0')}-${p.month}-${p.day}`, clock = `${p.hour}:${p.minute}:${p.second}`;
    const offset = repeatedTimeOffset(value, timeZone, {date:day, time:clock});
    return { day, clock, milliseconds: p.fractionalSecond,
      suffix: offset ? ` (${offset})` : '' };
  }
  return {
    count(value) {
      if (value === null) return missing;
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid count.');
      return counts.format(value);
    },
    duration(value) {
      if (value === null) return missing;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TypeError('Invalid duration.');
      }
      if (value > 0 && value < 0.001) return '<1 ms';
      const milliseconds = Math.round(value * 1000);
      if (milliseconds < 1000) return `${milliseconds} ms`;
      const seconds = Math.round(value * 10) / 10;
      if (seconds < 60) return `${seconds} s`;
      const whole = Math.round(value);
      if (whole < 3600) return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
      return `${Math.floor(whole / 3600)} h ${String(Math.floor(whole / 60) % 60).padStart(2, '0')} min`;
    },
    timestamp(value) {
      if (value === null) return missing;
      const p = parts(value);
      return `${p.day} ${p.clock}${p.suffix}`;
    },
    clock(value) {
      if (value === null) return missing;
      const p = parts(value);
      return `${p.clock}${p.suffix}`;
    },
    tableTimestamp(value, executionStart) {
      if (value === null) return missing;
      const p = parts(value), sameDay = executionStart != null && parts(executionStart).day === p.day;
      return `${sameDay ? '' : p.day + ' '}${p.clock}.${p.milliseconds}${p.suffix}`;
    },
  };
}

export function refreshStatus(display, generatedAt, poll, ended = false) {
  const mode = ended ? 'Execution ended · auto refresh off' : { idle: '', scheduled: poll.failures ? 'retry scheduled' : 'auto refresh on',
    paused: 'auto refresh paused', hidden: 'auto refresh paused (tab hidden)',
    updating: 'refreshing…', blocked: 'auto refresh stopped' }[poll.mode];
  const text = [generatedAt ? `Updated ${display.clock(generatedAt)}` : '', mode].filter(Boolean).join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
