import { formatId } from './display.js';
import { parseSelection, selectionSearch, validateSelection } from './selection.js';

function overviewBase(appBase, origin) {
  const base = new URL(appBase, origin);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash
      || !base.pathname.endsWith('/')) throw new TypeError('Invalid application base.');
  return base;
}

// Carry selection only. Cursors, page paths and protected observations stay in memory.
export function executionHref(executionId, selection, { appBase, origin, metadata }) {
  if (executionId === null) throw new TypeError('Missing execution ID.');
  formatId(executionId);
  const href = new URL(`executions/${executionId}`, overviewBase(appBase, origin));
  const search = selectionSearch(validateSelection(selection, metadata), metadata);
  if (search) href.searchParams.set('overview', search);
  return href.pathname + href.search;
}

export function readOverviewReturn(search, { appBase, origin, metadata }) {
  const base = overviewBase(appBase, origin);
  const fallback = { href: base.pathname, notice: '', selection: null };
  if (!search) return fallback;
  try {
    const params = new URLSearchParams(search);
    if ([...params.keys()].length !== 1 || !params.has('overview')
        || !params.get('overview').startsWith('?')) throw new TypeError();
    const selection = parseSelection(params.get('overview'), metadata);
    return { href: base.pathname + selectionSearch(selection, metadata), selection,
      notice: 'Overview opens these filters at page one.' };
  } catch {
    return { ...fallback, notice: 'Return filters are invalid. Overview opens at page one.' };
  }
}
