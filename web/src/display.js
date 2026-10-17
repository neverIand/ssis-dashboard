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

export function createDisplay({ timeZone, locale } = {}) {
  if (typeof timeZone !== 'string' || !timeZone) throw new TypeError('A display timezone is required.');
  const counts = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const durations = new Intl.NumberFormat(locale, {
    style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 3,
  });
  const timestamps = new Intl.DateTimeFormat(locale, {
    timeZone, dateStyle: 'medium', timeStyle: 'long',
  });
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
      return value > 0 && value < 0.001 ? `<${durations.format(0.001)}` : durations.format(value);
    },
    timestamp(value) {
      if (value === null) return missing;
      if (typeof value !== 'string' || !timestampPattern.test(value)) {
        throw new TypeError('Invalid wire timestamp.');
      }
      // Date/Intl is a display-only projection. The caller retains all seven wire digits.
      const date = new Date(value.slice(0, 23) + 'Z');
      if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
        throw new TypeError('Invalid wire timestamp.');
      }
      return timestamps.format(date);
    },
  };
}
