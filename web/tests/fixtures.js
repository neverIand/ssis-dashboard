export const requestId = '0123456789abcdef0123456789abcdef';
export const wireTime = '2026-10-17T16:00:00.1234567Z';

export function metadata() {
  return {
    app_version: '0.6.8', api_version: 'v1', display_timezone: 'Europe/London',
    capabilities: { events: false, values: false, override_values: false },
    limits: {
      default_limit: 50, max_limit: 200, default_range_hours: 360, max_range_hours: 744,
      max_timeline_buckets: 1000, cursor_ttl_seconds: 1800, max_cursor_characters: 8192,
      max_text_characters: 16384, max_search_characters: 512,
    },
    execution_statuses: [{ code: 1, name: 'created' }, { code: 2, name: 'running' }],
    executable_results: [{ code: 0, name: 'success' }],
    logging_levels: [{ code: 0, name: 'none' }],
    event_kinds: ['all'], execution_sorts: ['execution_id', 'created_at'],
  };
}

export function envelope(data = metadata()) {
  return { data, meta: { request_id: requestId, generated_at: wireTime } };
}

export function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId, ...headers },
  });
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
