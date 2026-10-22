import { ApiError, safeRequestId } from './api.js';
import { formatId } from './display.js';

export function executableQuery(value, metadata) {
  const query = { sort: value.sort, direction: value.direction, limit: value.limit };
  if (!['started_at', 'statistics_id'].includes(query.sort) || !['asc', 'desc'].includes(query.direction)
      || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > metadata.limits.max_limit) {
    throw new TypeError('Invalid executable order or page size.');
  }
  return query;
}

export function readExecutablePage(response, executionId, query, metadata, display) {
  try {
    const { data, meta } = response;
    if (!Array.isArray(data) || data.length > query.limit || !safeRequestId(meta.request_id)
        || meta.limit !== query.limit || meta.sort !== query.sort || meta.direction !== query.direction
        || meta.from !== null || meta.to !== null || meta.consistency !== 'live'
        || !['available', 'not-recorded', 'unknown'].includes(meta.availability)
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
    const text = (value, max, units = false) => {
      if (value === null) return;
      if (typeof value !== 'string' || value.length > max * (units ? 1 : 2)) throw new TypeError();
      const characters = [...value];
      if ((!units && characters.length > max) || characters.some(character => {
        const point = character.codePointAt(0);
        return point >= 0xd800 && point <= 0xdfff;
      })) throw new TypeError();
    };
    const ids = new Set();
    for (const row of data) {
      if (row.execution_id !== executionId || row.statistics_id === null || row.executable_id === null
          || ids.has(row.statistics_id)) throw new TypeError();
      formatId(row.statistics_id);
      formatId(row.executable_id);
      if (BigInt(row.statistics_id) > BigInt(meta.upper_id)) throw new TypeError();
      ids.add(row.statistics_id);
      text(row.package_name, 260, true);
      text(row.name, 4000, true);
      text(row.package_path, 16384);
      text(row.execution_path, 16384);
      display.timestamp(row.started_at);
      display.timestamp(row.ended_at);
      display.duration(row.duration_seconds);
      if ((row.started_at === null || row.ended_at === null) && row.duration_seconds !== null) throw new TypeError();
      if (row.result !== null) {
        const result = row.result;
        const known = metadata.executable_results.find(item => item.code === result.code);
        if (!Number.isSafeInteger(result.code) || result.code < -32768 || result.code > 32767
            || result.name !== (known?.name ?? 'unknown')) throw new TypeError();
      }
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}
