import { formatId } from './display.js';
import { allHistoryStatuses, historyQuery } from './history.js';
import { observationText } from './observation-page.js';

const names = ['match', 'folder', 'project', 'package', 'status', 'sort', 'direction', 'limit'];
export function historySelection(value, metadata) {
  if (!['exact', 'like'].includes(value.match)) throw new TypeError('Invalid history matching mode.');
  const selection = { match: value.match };
  for (const key of ['folder', 'project', 'package']) {
    const max = value.match === 'like' ? 512 : key === 'package' ? 260 : 128;
    observationText(value[key], max, true);
    if (!value[key] || value[key].includes('\0')) throw new TypeError('Invalid history selector.');
    selection[key] = value[key];
  }
  return { ...selection, ...historyQuery(value, metadata) };
}
export function parseHistorySelection(search, metadata) {
  if (search.length > 20000 || /%(?![0-9a-f]{2})/i.test(search)) throw new TypeError('Invalid history URL.');
  const defaults = { match: 'like', folder: '*', project: '*', package: '*', status: allHistoryStatuses(metadata),
    sort: 'execution_id', direction: 'desc', limit: metadata.limits.default_limit };
  const params = new URLSearchParams(search), seen = new Set();
  for (const [key, value] of params) {
    if (!names.includes(key) || seen.has(key)) throw new TypeError('Invalid history URL.');
    if (key === 'limit' && !/^[1-9]\d*$/.test(value)) throw new TypeError('Invalid history row limit.');
    seen.add(key);
    defaults[key] = key === 'limit' ? Number(value) : value;
  }
  for (const part of search.replace(/^\?/, '').split('&')) decodeURIComponent(part.replace(/\+/g, ' '));
  return historySelection(defaults, metadata);
}
export function historySearch(selection, metadata) {
  const value = historySelection(selection, metadata);
  return '?' + new URLSearchParams(names.map(key => [key, String(value[key])])).toString();
}
function baseURL(appBase, origin) {
  const base = new URL(appBase, origin);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash
      || !base.pathname.endsWith('/')) throw new TypeError('Invalid application base.');
  return base;
}
export function historyHref(selection, { appBase, origin, metadata }) {
  return new URL('history', baseURL(appBase, origin)).pathname + historySearch(selection, metadata);
}
export function historyExecutionHref(id, selection, { appBase, origin, metadata }) {
  formatId(id);
  const url = new URL(`executions/${id}`, baseURL(appBase, origin));
  url.searchParams.set('history', historySearch(selection, metadata));
  return url.pathname + url.search;
}
export function readHistoryReturn(search, options) {
  try {
    const params = new URLSearchParams(search);
    if ([...params.keys()].length !== 1 || !params.has('history') || !params.get('history').startsWith('?')) return null;
    const selection = parseHistorySelection(params.get('history'), options.metadata);
    return { selection, href: historyHref(selection, options) };
  } catch { return null; }
}
