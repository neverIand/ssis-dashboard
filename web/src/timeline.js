import { ApiError, safeRequestId } from './api.js';
import { timestampTicks } from './selection.js';

export const timelineSeries = { created_count: 'Created', started_count: 'With an actual start',
  succeeded_count: 'Currently succeeded', failed_count: 'Currently failed' };

export function timelineParams(selection, page, bucket) {
  if (!['day', 'hour'].includes(bucket)) throw new TypeError('Choose Day or Hour.');
  return { folder: selection.folder, project: selection.project, from: page.meta.from, to: page.meta.to,
    ...(selection.status.length ? { status: selection.status.join(',') } : {}), bucket };
}

export const timelineScope = (selection, page) => JSON.stringify([
  selection.folder, selection.project, selection.status, page.meta.from, page.meta.to]);

export function readTimeline(response, selection, page, bucket, metadata, display) {
  try {
    const {data, meta} = response;
    if (!safeRequestId(meta.request_id) || meta.generated_at === null || !Array.isArray(data) || !data.length
        || data.length > metadata.limits.max_timeline_buckets || meta.from !== page.meta.from || meta.to !== page.meta.to
        || meta.timezone !== metadata.display_timezone || meta.bucket !== bucket || !Array.isArray(meta.selected_statuses)
        || meta.selected_statuses.length !== selection.status.length
        || meta.selected_statuses.some((code,index) => code !== selection.status[index])) throw new TypeError();
    display.timestamp(meta.generated_at);
    const from = timestampTicks(meta.from), to = timestampTicks(meta.to);
    let previous = null;
    for (const row of data) {
      if (row.start === null || row.end === null) throw new TypeError();
      display.timestamp(row.start); display.timestamp(row.end);
      const start = timestampTicks(row.start), end = timestampTicks(row.end);
      if (start >= end || start >= to || end <= from || (previous !== null && previous !== row.start)) throw new TypeError();
      previous = row.end;
      for (const key of Object.keys(timelineSeries)) { if (row[key] === null) throw new TypeError(); display.count(row[key]); }
      if (row.started_count > row.created_count || BigInt(row.succeeded_count) + BigInt(row.failed_count) > BigInt(row.created_count)) throw new TypeError();
    }
    if (timestampTicks(data[0].start) > from || timestampTicks(data.at(-1).end) < to) throw new TypeError();
    return response;
  } catch { throw new ApiError('invalid_response', {requestId:response?.meta?.request_id}); }
}
