import { ApiError } from './api.js';
import { formatCode, formatId } from './display.js';
import { observationText, readObservationMeta } from './observation-page.js';
import { timestampTicks } from './selection.js';

export const allHistoryStatuses = metadata => metadata.execution_statuses.map(item => item.code).sort((a,b) => a-b).join(',');

export function historyQuery(value, metadata) {
  const codes = typeof value.status === 'string' ? value.status.split(',') : [];
  if (!codes.length || new Set(codes).size !== codes.length || codes.some(code => !/^[1-9]$/.test(code)
      || !metadata.execution_statuses.some(item => item.code === Number(code)))
      || value.sort !== 'execution_id' || !['asc', 'desc'].includes(value.direction)
      || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > metadata.limits.max_limit
      || value.from !== undefined || value.to !== undefined) throw new TypeError('Invalid history scope or order.');
  return { status: codes.sort().join(','), sort: 'execution_id', direction: value.direction, limit: value.limit };
}

export const historyIdentity = value => Object.fromEntries(['folder', 'project', 'package'].map(key => [key, value[`${key}_name`]]));
export const sameHistoryIdentity = (left, right) => ['folder_name', 'project_name', 'package_name'].every(key => left[key] === right[key]);

export function readHistoryPage(response, _executionId, query, metadata, display, identity) {
  try {
    readObservationMeta(response, query, metadata, display, { availability: false });
    let previous = null;
    for (const row of response.data) {
      if (row.execution_id === null) throw new TypeError();
      formatId(row.execution_id);
      const id = BigInt(row.execution_id);
      if (id > BigInt(response.meta.upper_id) || (previous !== null && (query.direction === 'asc' ? id <= previous
        : id >= previous))) throw new TypeError();
      previous = id;
      for (const [key, width] of [['folder_name',128], ['project_name',128], ['package_name',260]]) {
        observationText(row[key], width, true);
        if (!row[key] || row[key].includes('\0') || row[key] !== identity[key]) throw new TypeError();
      }
      if (!query.status.split(',').includes(String(row.status?.code))
          || row.status.name !== metadata.execution_statuses.find(item => item.code === row.status.code)?.name) throw new TypeError();
      formatCode(row.status);
      if (row.created_at === null) throw new TypeError();
      for (const key of ['created_at', 'started_at', 'ended_at']) display.timestamp(row[key]);
      display.duration(row.duration_seconds); display.duration(row.elapsed_seconds);
      if ((row.started_at === null && (row.duration_seconds !== null || row.elapsed_seconds !== null))
          || (row.ended_at === null && row.duration_seconds !== null)) throw new TypeError();
      if (row.estimate !== null) {
        const estimate = row.estimate;
        if (row.started_at === null || estimate.method !== 'mean_last_5_successful'
            || !Number.isSafeInteger(estimate.sample_count) || estimate.sample_count < 1 || estimate.sample_count > 5
            || !(estimate.duration_seconds > 0) || estimate.ended_at === null) throw new TypeError();
        display.duration(estimate.duration_seconds); display.timestamp(estimate.ended_at);
        if (timestampTicks(estimate.ended_at) < timestampTicks(row.started_at)) throw new TypeError();
      }
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}
