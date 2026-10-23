import { formatId } from './display.js';
import { safeRequestId } from './api.js';

export function observationQuery(value, metadata, idSort) {
  const query = { sort: value.sort, direction: value.direction, limit: value.limit };
  if (!['started_at', idSort].includes(query.sort) || !['asc', 'desc'].includes(query.direction)
      || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > metadata.limits.max_limit) {
    throw new TypeError('Invalid observation order or page size.');
  }
  return query;
}

export function readObservationMeta({ data, meta }, query, metadata, display) {
  if (!Array.isArray(data) || data.length > query.limit || !safeRequestId(meta.request_id)
      || meta.limit !== query.limit || meta.sort !== query.sort || meta.direction !== query.direction
      || meta.from !== null || meta.to !== null || meta.consistency !== 'live'
      || !['available', 'not-recorded', 'unknown'].includes(meta.availability)
      || (data.length && meta.availability === 'not-recorded')
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

export function observationText(value, max, units = false) {
  if (value === null) return;
  if (typeof value !== 'string' || value.length > max * (units ? 1 : 2)) throw new TypeError();
  const characters = [...value];
  if ((!units && characters.length > max) || characters.some(character => {
    const point = character.codePointAt(0);
    return point >= 0xd800 && point <= 0xdfff;
  })) throw new TypeError();
}
