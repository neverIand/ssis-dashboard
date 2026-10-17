const keys = new Set(['folder', 'project', 'status', 'from', 'to', 'sort', 'direction', 'limit']);
const ticksPerSecond = 10000000n;

export class SelectionError extends Error {}

function invalid(message) { throw new SelectionError(message); }

export function catalogName(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('\0')
      || [...value].some((character) => {
        const code = character.codePointAt(0);
        return code >= 0xd800 && code <= 0xdfff;
      })) invalid('Names must contain 1–128 UTF-16 units without invalid characters.');
  return value;
}

function daysBeforeYear(year) {
  const previous = year - 1;
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

export function timestampTicks(value) {
  const match = typeof value === 'string'
    && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const fail = () => invalid('Use valid RFC 3339 times with Z or an explicit offset, and up to 7 fractional digits.');
  if (!match || match[8] === '-00:00') fail();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > months[month - 1]
      || hour > 23 || minute > 59 || second > 59) fail();
  const zone = match[8];
  const zoneHours = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const zoneMinutes = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes !== 0)) fail();
  const offset = (zoneHours * 60 + zoneMinutes) * (zone.startsWith('-') ? -1 : 1);
  const days = daysBeforeYear(year) + months.slice(0, month - 1).reduce((sum, count) => sum + count, 0) + day - 1;
  const seconds = ((days * 24 + hour) * 60 + minute - offset) * 60 + second;
  const ticks = BigInt(seconds) * ticksPerSecond + BigInt((match[7] ?? '').padEnd(7, '0'));
  if (ticks < 0n || ticks >= BigInt(daysBeforeYear(10000)) * 86400n * ticksPerSecond) fail();
  return ticks;
}

export function defaultSelection(metadata) {
  return { folder: null, project: null, status: [], from: null, to: null,
    sort: 'execution_id', direction: 'desc', limit: metadata.limits.default_limit };
}

export function validateSelection(value, metadata) {
  const result = { ...value, status: [...value.status] };
  for (const key of ['folder', 'project']) if (result[key] !== null) catalogName(result[key]);
  const codes = new Set(metadata.execution_statuses.map((item) => item.code));
  if (result.status.some((code) => !codes.has(code)) || new Set(result.status).size !== result.status.length) {
    invalid('Choose valid statuses without duplicates.');
  }
  result.status.sort((a, b) => a - b);
  if (!metadata.execution_sorts.includes(result.sort) || !['asc', 'desc'].includes(result.direction)) {
    invalid('Choose a supported sort and direction.');
  }
  if (!Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > metadata.limits.max_limit) {
    invalid(`Page size must be between 1 and ${metadata.limits.max_limit}.`);
  }
  const from = result.from === null ? null : timestampTicks(result.from);
  const to = result.to === null ? null : timestampTicks(result.to);
  if (from !== null && to !== null) {
    const span = to - from;
    if (span <= 0n || span > BigInt(metadata.limits.max_range_hours) * 3600n * ticksPerSecond) {
      invalid(`The creation range must be positive and no longer than ${metadata.limits.max_range_hours} hours.`);
    }
  }
  // Preserve the supplied offset and all fractional digits; ticks are for validation only.
  return Object.freeze({ ...result, status: Object.freeze(result.status) });
}

export function parseSelection(search, metadata) {
  const value = defaultSelection(metadata);
  const seen = new Set();
  const raw = search.startsWith('?') ? search.slice(1) : search;
  for (const part of raw ? raw.split('&') : []) {
    const separator = part.indexOf('=');
    let key, text;
    try {
      if (separator < 1) throw new Error();
      key = decodeURIComponent(part.slice(0, separator).replaceAll('+', ' '));
      text = decodeURIComponent(part.slice(separator + 1).replaceAll('+', ' '));
    } catch { invalid('The filter URL contains invalid encoding.'); }
    if (!keys.has(key) || seen.has(key) || !text || text.includes('\0')) {
      invalid('The filter URL contains unsupported, repeated or empty parameters.');
    }
    seen.add(key);
    if (key === 'status') {
      if (!/^[1-9](?:,[1-9])*$/.test(text)) invalid('Choose valid statuses without duplicates.');
      value.status = text.split(',').map(Number);
    } else if (key === 'limit') {
      if (!/^[0-9]+$/.test(text) || text.length > String(metadata.limits.max_limit).length) {
        invalid('The filter URL contains an invalid page size.');
      }
      value.limit = Number(text);
    } else value[key] = text;
  }
  return validateSelection(value, metadata);
}

export function selectionParams(value) {
  return { folder: value.folder, project: value.project, status: value.status.length ? value.status.join(',') : null,
    from: value.from, to: value.to, sort: value.sort, direction: value.direction, limit: value.limit };
}

export function selectionSearch(value, metadata) {
  const params = new URLSearchParams();
  for (const [key, text] of Object.entries(selectionParams(value))) {
    if (text === null || (key === 'sort' && text === 'execution_id')
        || (key === 'direction' && text === 'desc')
        || (key === 'limit' && text === metadata.limits.default_limit)) continue;
    params.set(key, String(text));
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function createSelectionSession(metadata) {
  let applied = null;
  let draft = defaultSelection(metadata);
  return {
    get applied() { return applied; },
    get draft() { return { ...draft, status: [...draft.status] }; },
    update(changes) {
      if ('folder' in changes && changes.folder !== draft.folder) changes = { ...changes, project: null };
      draft = { ...draft, ...changes };
    },
    apply() {
      applied = validateSelection(draft, metadata);
      draft = { ...applied };
      return applied;
    },
    order(changes) {
      if (applied === null) invalid('Apply a valid selection before changing the table.');
      const order = Object.fromEntries(['sort', 'direction', 'limit'].map((key) => [key,
        key in changes ? changes[key] : applied[key]]));
      applied = validateSelection({ ...applied, ...order }, metadata);
      const { sort, direction, limit } = applied;
      draft = { ...draft, sort, direction, limit };
      return applied;
    },
    restore(search) {
      applied = null;
      const restored = parseSelection(search, metadata);
      applied = restored;
      draft = { ...restored };
      return applied;
    },
  };
}
