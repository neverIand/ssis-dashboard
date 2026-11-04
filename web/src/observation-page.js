import { formatId } from './display.js';
import { safeRequestId } from './api.js';

export function observationQuery(value, metadata, idSort, timeSort = 'started_at') {
  const query = { sort: value.sort, direction: value.direction, limit: value.limit };
  if (![timeSort, idSort].includes(query.sort) || !['asc', 'desc'].includes(query.direction)
      || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > metadata.limits.max_limit) {
    throw new TypeError('Invalid observation order or page size.');
  }
  return query;
}

export function readObservationMeta({ data, meta }, query, metadata, display, { availability = true } = {}) {
  if (!Array.isArray(data) || data.length > query.limit || !safeRequestId(meta.request_id)
      || meta.limit !== query.limit || meta.sort !== query.sort || meta.direction !== query.direction
      || meta.from !== null || meta.to !== null || meta.consistency !== 'live'
      || (availability && (!['available', 'not-recorded', 'unknown'].includes(meta.availability)
        || (data.length && meta.availability === 'not-recorded')))
      || typeof meta.has_more !== 'boolean' || (meta.has_more
        ? !data.length || typeof meta.next_cursor !== 'string' || !meta.next_cursor
          || meta.next_cursor.length > metadata.limits.max_cursor_characters
        : meta.next_cursor !== null)) throw new TypeError();
  for (const time of [meta.generated_at, meta.as_of]) {
    if (time === null) throw new TypeError();
    display.timestamp(time);
  }
  if (meta.upper_id === null) { if (data.length) throw new TypeError(); }
  else formatId(meta.upper_id);
}

// Code points in a string, or -1 for a lone surrogate. Scans in place: messages and
// paths reach tens of thousands of characters, so no per-character array is built.
export function codePointCount(value) {
  let count = 0;
  for (let index = 0; index < value.length; index++, count++) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const next = value.charCodeAt(index + 1);
    if (unit > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) return -1;
    index++;
  }
  return count;
}

// The first `limit` code points followed by an ellipsis, or null when the text already fits.
export function clippedText(value, limit) {
  for (let index = 0, count = 0; index < value.length; index++, count++) {
    if (count === limit) return `${value.slice(0, index)}…`;
    const unit = value.charCodeAt(index), next = value.charCodeAt(index + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
  }
  return null;
}

export function observationText(value, max, units = false) {
  if (value === null) return;
  if (typeof value !== 'string' || value.length > max * (units ? 1 : 2)) throw new TypeError();
  const count = codePointCount(value);
  if (count < 0 || (!units && count > max)) throw new TypeError();
}
