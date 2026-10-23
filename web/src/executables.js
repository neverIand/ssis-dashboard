import { ApiError } from './api.js';
import { formatId } from './display.js';
import { observationQuery, readObservationMeta, observationText as text } from './observation-page.js';

export const executableQuery = (value, metadata) => observationQuery(value, metadata, 'statistics_id');

export function readExecutablePage(response, executionId, query, metadata, display) {
  try {
    const { data, meta } = response;
    readObservationMeta(response, query, metadata, display);
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
