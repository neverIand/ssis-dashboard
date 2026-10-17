const requestIdPattern = /^[a-f0-9]{32}$/;
const problemCodes = new Set([
  'invalid_input', 'invalid_cursor', 'cursor_expired', 'unauthenticated', 'forbidden',
  'not_found', 'method_not_allowed', 'internal_error', 'database_unavailable', 'database_timeout',
]);

export class ApiError extends Error {
  constructor(kind, { status = null, requestId = null, code = null } = {}) {
    const messages = {
      network: 'Unable to connect. Try again.',
      timeout: 'The request timed out. Try again.',
      invalid_response: 'The server returned an unexpected response.',
      invalid_metadata: 'The page settings could not be loaded.',
    };
    const httpMessages = {
      400: 'The request could not be accepted.',
      401: 'Sign-in is required.',
      403: 'Access is denied.',
      404: 'The requested resource is unavailable.',
      503: 'The service is unavailable. Try again.',
      504: 'The service did not respond in time. Try again.',
    };
    super(messages[kind] ?? httpMessages[status] ?? 'The request failed. Try again.');
    this.name = 'ApiError';
    Object.assign(this, { kind, status, requestId: safeRequestId(requestId), code });
  }
}

export function safeRequestId(value) {
  return typeof value === 'string' && requestIdPattern.test(value) ? value : null;
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cancelled = () => new DOMException('Request cancelled.', 'AbortError');

export function createApi(apiBase, { origin = globalThis.location?.origin, fetchImpl = globalThis.fetch } = {}) {
  const base = new URL(apiBase, origin);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash
      || !base.pathname.endsWith('/')) {
    throw new TypeError('Invalid API base.');
  }

  return {
    async get(resource, { params = {}, signal } = {}) {
      const url = new URL(resource, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.hash
          || url.username || url.password) {
        throw new TypeError('Invalid API resource.');
      }
      for (const [name, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
          throw new TypeError('Invalid query value.');
        }
        url.searchParams.set(name, String(value));
      }
      try {
        if (signal?.aborted) throw cancelled();
        const response = await fetchImpl(url, {
          method: 'GET', mode: 'same-origin', credentials: 'same-origin',
          cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal,
        });
        if (signal?.aborted) throw cancelled();
        const mediaType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
        let payload = null;
        if (mediaType === 'application/json' || mediaType === 'application/problem+json') {
          try {
            payload = await response.json();
          } catch {
            // A non-JSON proxy/error body is never used as product copy.
          }
        }
        if (signal?.aborted) throw cancelled();
        const requestId = safeRequestId(response.headers.get('X-Request-ID'))
          ?? safeRequestId(payload?.request_id) ?? safeRequestId(payload?.meta?.request_id);
        if (!response.ok) {
          throw new ApiError('http', {
            status: response.status, requestId,
            code: problemCodes.has(payload?.code) ? payload.code : null,
          });
        }
        if (mediaType !== 'application/json' || !record(payload) || !('data' in payload)
            || !record(payload.meta) || !safeRequestId(payload.meta.request_id)
            || typeof payload.meta.generated_at !== 'string' || requestId !== payload.meta.request_id) {
          throw new ApiError('invalid_response', { status: response.status, requestId });
        }
        return payload;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw cancelled();
        if (error instanceof ApiError) throw error;
        throw new ApiError('network');
      }
    },
  };
}
