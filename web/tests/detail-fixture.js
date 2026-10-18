import { envelope, wireTime } from './fixtures.js';

export function detailResponse(executionId = '9223372036854775807') {
  return envelope({
    execution_id: executionId, folder_name: 'Folder 影狼', project_name: 'Project', package_name: 'Main.dtsx',
    project_lsn: '0', environment: { folder_name: null, name: null },
    status: { code: 7, name: 'succeeded' }, logging_level: { code: 0, name: 'none' },
    created_at: wireTime, started_at: wireTime, ended_at: wireTime,
    duration_seconds: 0, elapsed_seconds: 0, warning_count: 1, error_count: 0,
    event_counts: { all: 3, warnings: 1, errors: 0, duplicate_warnings: 1, memory_warnings: 1 },
  });
}

// DOM double for mounted startup/render behavior; no browser/layout claims.
export function detailDOM() {
  class Node extends EventTarget {
    constructor() { super(); this.textContent = ''; this.hidden = false; this.dataset = {}; this.attributes = new Map(); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    removeAttribute(key) { this.attributes.delete(key); }
  }
  const nodes = new Map();
  for (const key of ['app-status', 'retry', 'request-id', 'display-timezone', 'execution-detail',
    'detail-status', 'detail-retry', 'detail-request-id', 'detail-observed', 'active-elapsed']) {
    nodes.set(`[data-${key}]`, new Node());
  }
  const fields = ['folder', 'project', 'package', 'lsn', 'environment-folder', 'environment', 'status', 'logging',
    'created', 'started', 'ended', 'duration', 'elapsed', 'all', 'warnings', 'errors', 'duplicate_warnings', 'memory_warnings']
    .map(key => Object.assign(new Node(), { dataset: { detailField: key } }));
  const document = { location: { origin: 'https://example.test' }, getElementById(id) {
    if (id !== 'app-config') throw new Error('Unexpected element');
    return { textContent: JSON.stringify({ app_base: '/ops/app/', api_base: '/ops/api/v1/',
      execution_base: '/ops/execution/', execution_id: '9223372036854775807' }) };
  } };
  const root = { ownerDocument: document, dataset: {}, querySelector(selector) {
    if (!nodes.has(selector)) throw new Error(`No overview controls on detail: ${selector}`);
    return nodes.get(selector);
  }, querySelectorAll(selector) {
    if (selector !== '[data-detail-field]') throw new Error(`Unexpected selector: ${selector}`);
    return fields;
  } };
  return { root, get: key => nodes.get(`[data-${key}]`), field: key => fields.find(node => node.dataset.detailField === key) };
}
