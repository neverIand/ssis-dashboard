import { formatId } from './display.js';
import { parseSelection, selectionSearch, validateSelection } from './selection.js';
import { readHistoryReturn } from './history-navigation.js';

export const detailTabs = [
  ['events', 'Events'], ['executables', 'Executables'], ['children', 'Package calls'],
  ['parameters', 'Parameters'], ['overrides', 'Overrides'], ['history', 'History'],
];

export function tabAllowed(tab, metadata) {
  return detailTabs.some(([key]) => key === tab) && (tab === 'events' ? metadata.capabilities.events
    : ['parameters', 'overrides'].includes(tab) ? metadata.capabilities.values : true);
}

// Only public section/category tokens may enter a fragment. Search and cursors stay in memory.
export function detailFragment({ tab, kind }, metadata) {
  if (!detailTabs.some(([key]) => key === tab) || (kind !== undefined
      && (tab !== 'events' || !['all', 'errors', 'warnings', 'duplicate-warnings',
        'memory-warnings'].includes(kind)))) throw new TypeError('Invalid detail fragment.');
  return `#${tab}${tab === 'events' && kind && kind !== 'all' ? `/${kind}` : ''}`;
}

export function readDetailFragment(hash, metadata) {
  if (!hash) return null;
  const parts = hash.slice(1).split('/');
  const value = { tab: parts[0], ...(parts.length === 2 ? { kind: parts[1] } : {}) };
  try {
    if (!hash.startsWith('#') || parts.length > 2 || (parts.length === 2 && !parts[1])) return null;
    detailFragment(value, metadata);
    return value.tab === 'events' ? { ...value, kind: value.kind ?? 'all' } : value;
  } catch { return null; }
}

export function defaultDetailTab(requested, status, metadata) {
  if (requested && tabAllowed(requested.tab, metadata)
      && (requested.tab !== 'events' || metadata.event_kinds.includes(requested.kind ?? 'all'))) {
    return requested.tab === 'events' ? { tab: 'events', kind: requested.kind ?? 'all' } : requested;
  }
  return status.code === 4 && tabAllowed('events', metadata) && metadata.event_kinds.includes('errors')
    ? { tab: 'events', kind: 'errors' } : { tab: 'executables' };
}

function overviewBase(appBase, origin) {
  const base = new URL(appBase, origin);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash
      || !base.pathname.endsWith('/')) throw new TypeError('Invalid application base.');
  return base;
}

// Carry selection only. Cursors, page paths and protected observations stay in memory.
export function executionHref(executionId, selection, { appBase, origin, metadata, section = null }) {
  if (executionId === null) throw new TypeError('Missing execution ID.');
  formatId(executionId);
  const href = new URL(`executions/${executionId}`, overviewBase(appBase, origin));
  const search = selectionSearch(validateSelection(selection, metadata), metadata);
  if (search) href.searchParams.set('overview', search);
  if (section) href.hash = detailFragment(section, metadata);
  return href.pathname + href.search + href.hash;
}

export function readOverviewReturn(search, { appBase, origin, metadata }) {
  const base = overviewBase(appBase, origin);
  const fallback = { href: base.pathname, notice: '', selection: null };
  if (!search) return fallback;
  if (readHistoryReturn(search, { appBase, origin, metadata })) return fallback;
  try {
    const params = new URLSearchParams(search);
    if ([...params.keys()].length !== 1 || !params.has('overview')
        || !params.get('overview').startsWith('?')) throw new TypeError();
    const selection = parseSelection(params.get('overview'), metadata);
    return { href: base.pathname + selectionSearch(selection, metadata), selection,
      notice: '' };
  } catch {
    return { ...fallback, notice: 'Return filters are invalid. Overview opens at page one.' };
  }
}
