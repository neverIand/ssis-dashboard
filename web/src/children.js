import { ApiError } from './api.js';
import { formatId } from './display.js';
import { observationQuery, readObservationMeta, observationText } from './observation-page.js';

export const childQuery = (value, metadata) => observationQuery(value, metadata, 'observation_id');

export function readChildPage(response, executionId, query, metadata, display) {
  try {
    readObservationMeta(response, query, metadata, display);
    const { data, meta } = response;
    if (typeof meta.has_unidentified_starts !== 'boolean'
        || (meta.has_unidentified_starts && meta.availability !== 'unknown')) throw new TypeError();
    const ids = new Set();
    for (const row of data) {
      if (row.execution_id !== executionId || row.observation_id === null || ids.has(row.observation_id)) throw new TypeError();
      formatId(row.observation_id);
      if (BigInt(row.observation_id) > BigInt(meta.upper_id)) throw new TypeError();
      ids.add(row.observation_id);
      observationText(row.package_name, 260, true);
      observationText(row.source_name, 4000, true);
      observationText(row.execution_path, 16384);
      if (row.package_name === '' || row.package_path !== '\\Package' || typeof row.execution_path !== 'string'
          || !row.execution_path.slice(1).includes('\\') || row.started_at === null) throw new TypeError();
      if (row.source_type !== null && (!Number.isSafeInteger(row.source_type)
          || row.source_type < -32768 || row.source_type > 32767)) throw new TypeError();
      display.timestamp(row.started_at);
      display.timestamp(row.ended_at);
      display.duration(row.duration_seconds);
      if (row.state === 'incomplete') {
        if (row.ended_at !== null || row.duration_seconds !== null) throw new TypeError();
      } else if (row.state === 'complete') {
        if (row.ended_at === null || row.duration_seconds === null || row.ended_at < row.started_at
            || row.package_name === null) throw new TypeError();
      } else throw new TypeError();
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}
