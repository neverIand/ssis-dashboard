import { ApiError } from './api.js';
import { formatId } from './display.js';
import { observationQuery, readObservationMeta, observationText } from './observation-page.js';

export function eventQuery(value, metadata) {
  const query = observationQuery(value, metadata, 'event_id', 'message_time');
  const q = value.q === '' || value.q === undefined ? null : value.q;
  if (!metadata.event_kinds.includes(value.kind) || (q !== null &&
      (typeof q !== 'string' || q.includes('\0') || q.length > metadata.limits.max_search_characters * 2))) throw new TypeError();
  observationText(q, metadata.limits.max_search_characters);
  return { ...query, kind: value.kind, q };
}

export function readEventPage(response, executionId, query, metadata, display) {
  try {
    readObservationMeta(response, query, metadata, display);
    const { data, meta } = response;
    if (typeof meta.has_unidentified_events !== 'boolean'
        || (meta.has_unidentified_events && meta.availability !== 'unknown')) throw new TypeError();
    const ids = new Set();
    for (const row of data) {
      if (row.execution_id !== executionId || row.event_id === null || ids.has(row.event_id)) throw new TypeError();
      formatId(row.event_id);
      if (BigInt(row.event_id) > BigInt(meta.upper_id) || row.message_time === null) throw new TypeError();
      ids.add(row.event_id);
      display.timestamp(row.message_time);
      for (const field of ['message_type', 'source_type']) {
        if (field === 'source_type' && row[field] === null) continue;
        if (!Number.isSafeInteger(row[field]) || row[field] < -32768 || row[field] > 32767) throw new TypeError();
      }
      for (const [field, max] of [['event_name', 1024], ['package_name', 260], ['source_name', 4000], ['subcomponent_name', 4000]]) {
        observationText(row[field], max, true);
      }
      if (row.package_name === '') throw new TypeError();
      for (const field of ['package_path', 'execution_path']) observationText(row[field], 16384);
      observationText(row.message, metadata.limits.max_text_characters);
      if (typeof row.truncated !== 'boolean' || (row.truncated &&
          (row.message === null || [...row.message].length !== metadata.limits.max_text_characters))) throw new TypeError();
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}
