import { envelope, wireTime } from './fixtures.js';
import { Node } from './overview-dom.js';

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
  const window = Object.assign(new EventTarget(), { location: { origin: 'https://example.test', search: '' },
    scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } });
  const document = Object.assign(new EventTarget(), { location: window.location, defaultView: window,
    visibilityState: 'visible', activeElement: null });
  document.createElement = tag => new Node(document, tag);
  document.createTextNode = value => new Node(document, '#text', value);
  const root = new Node(document, 'root'), main = new Node(document, 'main');
  document.body = new Node(document, 'body');
  document.activeElement = document.body;
  const nodes = new Map();
  for (const key of ['app-status', 'retry', 'request-id', 'display-timezone', 'execution-detail',
    'detail-status', 'detail-retry', 'detail-request-id', 'detail-observed', 'active-elapsed',
    'detail-refresh', 'detail-poll-toggle', 'detail-poll-status', 'overview-link', 'legacy-detail-link',
    'overview-return-notice', 'parameters-unavailable', 'overrides-unavailable', 'overrides-policy', ...['filters','choices','apply','scope'].map(key => `history-${key}`), ...['unavailable','filters','apply','reset','kind','q','scope'].map(key => `events-${key}`), ...['toggle', 'panel', 'status', 'notice', 'retry', 'sort', 'direction',
      'limit', 'previous', 'next', 'latest', 'scroll', 'table'].flatMap(name => ['executables', 'children', 'events', 'parameters', 'overrides', 'history'].map(section => `${section}-${name}`))]) {
    const node = new Node(document, key.includes('retry') || /toggle|previous|next|latest|refresh$/.test(key) ? 'button' : 'div');
    nodes.set(`[data-${key}]`, node);
    root.append(node);
  }
  const get = key => nodes.get(`[data-${key}]`);
  const fields = ['folder', 'project', 'package', 'lsn', 'environment-folder', 'environment', 'status', 'logging',
    'created', 'started', 'ended', 'duration', 'elapsed', 'all', 'warnings', 'errors', 'duplicate_warnings', 'memory_warnings']
    .map(key => Object.assign(new Node(document, 'dd'), { dataset: { detailField: key } }));
  // Package/status live in the visible page heading, outside the hideable detail body.
  root.append(...fields.filter(node => ['package', 'status'].includes(node.dataset.detailField)));
  get('execution-detail').append(...fields.filter(node => !['package', 'status'].includes(node.dataset.detailField)));
  const bodies = {};
  for (const section of ['executables', 'children', 'events', 'parameters', 'overrides', 'history']) {
    get('execution-detail').append(get(`${section}-toggle`), get(`${section}-panel`));
    get(`${section}-panel`).append(...['status', 'notice', 'retry', 'sort', 'direction', 'limit',
      'previous', 'next', 'latest', 'scroll'].map(key => get(`${section}-${key}`)));
    get(`${section}-scroll`).append(get(`${section}-table`));
    const body = new Node(document, 'tbody');
    bodies[section] = body;
    get(`${section}-table`).append(body);
    get(`${section}-table`).querySelector = selector => selector === 'tbody' ? body : null;
    get(`${section}-retry`).hidden = get(`${section}-panel`).hidden = true;
  }
  get('events-panel').append(get('events-filters'),get('events-scope'));
  get('events-filters').append(...['kind','q','apply','reset'].map(key => get(`events-${key}`)));
  get('history-panel').append(get('history-filters'),get('history-scope'));
  get('history-filters').append(get('history-choices'),get('history-apply'));
  const body = bodies.executables;
  document.getElementById = id => id === 'main-content' ? main : {
    textContent: JSON.stringify({ app_base: '/ops/app/', api_base: '/ops/api/v1/',
      execution_base: '/ops/execution/', execution_id: '9223372036854775807' }) };
  get('detail-retry').hidden = get('executables-retry').hidden = get('executables-panel').hidden = true;
  root.querySelector = selector => { if (!nodes.has(selector)) throw new Error(`Missing detail fixture node: ${selector}`); return nodes.get(selector); };
  root.querySelectorAll = selector => { if (selector !== '[data-detail-field]') throw new Error(`Unexpected selector: ${selector}`); return fields; };
  return { root, document, window, main, body, childBody: bodies.children, eventBody: bodies.events, parameterBody: bodies.parameters, overrideBody: bodies.overrides, historyBody: bodies.history, get,
    field: key => fields.find(node => node.dataset.detailField === key) };
}
