import { formatCode } from './display.js';
import { createCatalogSearch } from './catalog-search.js';
import { executionHref, readDetailFragment } from './detail-navigation.js';
import { mountRangeEditor } from './range-editor.js';
import { catalogName, createSelectionSession, SelectionError, selectionSearch, validateSelection } from './selection.js';
import { rangeLabel } from './time-range.js';

export function mountFilters(root, { metadata, api, appBase, onApplied = () => {}, effectiveWindow = () => null }) {
  const document = root.ownerDocument, window = document.defaultView;
  const form = root.querySelector('#overview-filters');
  const get = selector => form.querySelector(selector);
  const fieldset = get('fieldset'), notice = get('[data-filter-notice]');
  const reset = get('[data-reset-filters]');
  const recover = get('[data-recover-filters]'), status = get('#status');
  const order = Object.fromEntries(['sort', 'limit']
    .map(key => [key, root.querySelector(`[data-order="${key}"]`)]));
  const orderNotice = root.querySelector('[data-order-notice]');
  const headers = [...root.querySelectorAll('[data-sort]')];
  const sortNames = { execution_id: 'ID', created_at: 'Created', started_at: 'Started', ended_at: 'Ended',
    project_name: 'Project', package_name: 'Entry package', environment: 'Environment', status: 'Status',
    logging_level: 'Logging level', duration_seconds: 'Duration', warning_count: 'Warnings', error_count: 'Errors' };
  const session = createSelectionSession(metadata), removers = [];
  const pickers = new Map();
  let opened = null, searchTimer = null;
  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    removers.push(() => element.removeEventListener(event, handler));
  }
  order.sort.replaceChildren(...metadata.execution_sorts.flatMap(key => ['desc', 'asc'].map(direction => {
    const option = document.createElement('option');
    option.value = `${key}:${direction}`;
    option.textContent = `${sortNames[key] ?? key} ${direction === 'asc' ? '↑' : '↓'}`;
    return option;
  })));
  function close({ focus = false, commitStatus = true } = {}) {
    if (!opened) return;
    clearTimeout(searchTimer);
    const { panel, trigger, key } = opened;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    pickers.get(key)?.cancel();
    if (key === 'created') range.cancel();
    opened = null;
    if (key === 'status' && commitStatus) commit();
    if (focus) trigger.focus();
  }
  function position() {
    if (!opened) return;
    const box = form.getBoundingClientRect(), anchor = opened.trigger.getBoundingClientRect();
    const width = opened.panel.getBoundingClientRect().width;
    opened.panel.style.left = `${Math.max(0, Math.min(anchor.left - box.left, box.width - width))}px`;
    opened.panel.style.top = `${anchor.bottom - box.top + 8}px`;
  }
  function label(key, value) {
    get(`[data-filter-label="${key}"]`).textContent = value;
    const trigger = get(`[data-open-filter="${key}"]`);
    trigger.setAttribute('aria-label', `${key === 'created' ? 'Created' : key[0].toUpperCase() + key.slice(1)}: ${value}`);
    trigger.title = value;
  }
  function showDraft() {
    const draft = session.draft;
    label('folder', draft.folder ?? 'All folders');
    label('project', draft.project ?? 'All projects');
    for (const checkbox of status.querySelectorAll('input')) {
      checkbox.checked = checkbox.value === '' ? !draft.status.length : draft.status.includes(Number(checkbox.value));
    }
    const names = metadata.execution_statuses.filter(item => draft.status.includes(item.code)).map(formatCode);
    label('status', names.length ? names.join(', ') : 'All statuses');
    label('created', rangeLabel(draft, metadata.display_timezone));
    const changed = JSON.stringify(draft) !== JSON.stringify(session.applied);
    notice.textContent = changed ? 'Close Status to apply; Escape cancels.' : '';
  }
  function showApplied(selection, options) {
    const sizes = [...new Set([25, 50, 100, 200, metadata.limits.default_limit, selection.limit])]
      .filter(value => value <= metadata.limits.max_limit).sort((a,b) => a-b);
    order.limit.replaceChildren(...sizes.map(value => {
      const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); return option;
    }));
    order.limit.value = String(selection.limit);
    order.sort.value = `${selection.sort}:${selection.direction}`;
    for (const button of headers) {
      const supported = metadata.execution_sorts.includes(button.dataset.sort);
      button.disabled = !supported;
      button.parentElement.setAttribute('aria-sort', !supported || button.dataset.sort !== selection.sort ? 'none'
        : selection.direction === 'asc' ? 'ascending' : 'descending');
    }
    orderNotice.textContent = '';
    onApplied(selection, options);
  }
  function commit() {
    if (session.applied === null) return;
    try {
      const before = selectionSearch(session.applied, metadata);
      const selection = session.apply();
      writeUrl(selection); showDraft();
      if (selectionSearch(selection, metadata) !== before) showApplied(selection);
    } catch (error) { notice.textContent = error instanceof SelectionError ? error.message : 'Filters could not be applied.'; }
  }
  function select(changes) {
    let value = { ...session.draft, ...changes };
    if ('folder' in changes && changes.folder !== session.draft.folder && !('project' in changes)) value.project = null;
    value = validateSelection(value, metadata);
    close({ commitStatus: false });
    session.update(value);
    commit();
  }
  function writeUrl(selection, replace = false) {
    const url = appBase + selectionSearch(selection, metadata) + window.location.hash;
    if (replace) window.history.replaceState(null, '', url);
    else if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(null, '', url);
  }
  function chooseScope(key, name) {
    try {
      if (name !== null) catalogName(name);
      const trigger = opened?.trigger;
      select({ [key]: name });
      trigger?.focus();
    } catch (error) { notice.textContent = error instanceof SelectionError ? error.message : 'Scope could not be changed.'; }
  }

  for (const key of ['folder', 'project']) {
    const search = get(`#${key}-search`), choices = get(`[data-catalog-choices="${key}"]`);
    const message = get(`[data-catalog-status="${key}"]`), more = get(`[data-catalog-more="${key}"]`);
    const retry = get(`[data-catalog-retry="${key}"]`), exact = get(`[data-exact-scope="${key}"]`);
    const owner = createCatalogSearch({ api, kind: `${key}s`, limit: metadata.limits.default_limit,
      publish(state) {
        const focused = document.activeElement;
        const focusId = choices.contains(focused) ? focused?.dataset?.catalogId : undefined;
        const previousCount = choices.children.length;
        choices.replaceChildren(...state.rows.map(row => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'catalog-choice'; button.textContent = row.name;
          button.dataset.catalogId = row[`${key}_id`];
          button.setAttribute('aria-pressed', String(session.applied?.[key] === row.name));
          button.addEventListener('click', () => chooseScope(key, row.name));
          return button;
        }));
        more.hidden = state.complete || state.phase === 'idle' || state.phase === 'error';
        // Keep the request control focusable while its owner ignores duplicates.
        more.setAttribute('aria-disabled', String(state.phase === 'loading'));
        more.textContent = search.value ? 'Search more' : 'Load more';
        retry.hidden = state.phase !== 'error';
        message.textContent = state.phase === 'idle' ? 'Choose a folder to browse projects, or enter an exact project name across all folders.'
          : state.phase === 'loading' ? (search.value ? 'Searching the catalog…' : 'Loading…')
          : state.phase === 'error' ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}`
          : state.complete ? (state.rows.length ? `${state.rows.length} ${search.value ? 'matches' : `${key}s`}` : 'No matches.')
          : search.value ? `${state.rows.length} matches so far. Search more to continue through the catalog.` : '';
        if (state.phase === 'error' && ['invalid_cursor', 'cursor_expired'].includes(state.error.code)) {
          message.textContent = 'Choices expired. Retry restarts the search.';
        }
        if (focusId !== undefined) {
          ([...choices.children].find(button => button.dataset.catalogId === focusId)
            ?? (state.phase === 'error' ? retry : search)).focus();
        } else if (focused === more && state.phase !== 'loading') {
          (state.phase === 'error' ? retry : choices.children[previousCount] ?? (more.hidden ? search : more)).focus();
        }
      } });
    pickers.set(key, owner);
    const searchNow = () => { void owner.search(search.value, key === 'project' ? session.applied.folder : null); };
    listen(search, 'input', () => {
      owner.cancel(); clearTimeout(searchTimer);
      choices.replaceChildren(); more.hidden = true; retry.hidden = true;
      message.textContent = 'Searching…';
      exact.hidden = !search.value;
      searchTimer = setTimeout(searchNow, 250);
    });
    listen(search, 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); searchNow(); }
    });
    listen(more, 'click', () => { void owner.more(); });
    listen(retry, 'click', () => { void owner.retry(); });
    listen(exact, 'click', () => chooseScope(key, search.value));
    listen(get(`[data-all-scope="${key}"]`), 'click', () => chooseScope(key, null));
  }

  const range = mountRangeEditor(form, { metadata, listen, onChoose(bounds) {
    const trigger = opened?.trigger;
    select(bounds); trigger?.focus();
  } });
  for (const trigger of form.querySelectorAll('[data-open-filter]')) listen(trigger, 'click', () => {
    const key = trigger.dataset.openFilter;
    if (opened?.key === key) { close({ focus: true }); return; }
    close();
    const panel = get(`[data-filter-panel="${key}"]`);
    opened = { key, trigger, panel };
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    if (pickers.has(key)) {
      const search = get(`#${key}-search`);
      search.value = ''; get(`[data-exact-scope="${key}"]`).hidden = true;
      get(`[data-all-scope="${key}"]`).setAttribute('aria-pressed', String(session.applied[key] === null));
      void pickers.get(key).search('', key === 'project' ? session.applied.folder : null);
      search.focus();
    } else if (key === 'created') { range.open(session.draft, effectiveWindow()); get('[data-created-preset]').focus(); }
    else status.querySelector('input').focus();
    position();
  });
  for (const button of form.querySelectorAll('[data-close-filter]')) listen(button, 'click', () => close({ focus: true }));
  listen(document, 'pointerdown', event => {
    if (opened && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) {
      // Let a selection action consume the Status draft once. Prevent mouse focus
      // from committing and removing the clicked row before its click is delivered.
      if (opened.key === 'status' && event.target.closest?.('[data-selection-link], [data-sort], [data-execution-link]')) event.preventDefault();
      else close();
    }
  });
  function outsideClick(event) {
    if (!opened || opened.panel.contains(event.target) || opened.trigger.contains(event.target)) return;
    const link = event.target.closest?.('[data-execution-link]');
    if (opened.key === 'status' && link) {
      // The click has an activation target now. Update that exact anchor before
      // the commit clears rows, so ordinary and modified navigation carry Status.
      link.setAttribute('href', executionHref(link.dataset.executionId,
        validateSelection(session.draft, metadata), { metadata, appBase, origin: window.location.origin,
          section: readDetailFragment(new URL(link.href, window.location.origin).hash, metadata) }));
    }
    close();
  }
  listen(document, 'click', outsideClick);
  listen(document, 'auxclick', outsideClick);
  listen(form, 'keydown', event => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      if (opened.key === 'status') { session.update({ status: session.applied.status }); showDraft(); }
      close({ focus: true, commitStatus: false });
    }
    else if (event.key === 'Enter' && opened && event.target.tagName === 'INPUT') event.preventDefault();
  });
  listen(document, 'focusin', event => {
    if (opened && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) {
      close();
    }
  });
  listen(window, 'resize', position);
  listen(status, 'change', event => {
    const all = status.querySelector('input[value=""]');
    const codes = [...status.querySelectorAll('input')].filter(checkbox => checkbox.value !== '');
    if (event.target === all && all.checked) for (const checkbox of codes) checkbox.checked = false;
    session.update({ status: codes.filter(checkbox => checkbox.checked).map(checkbox => Number(checkbox.value)).sort((a,b) => a-b) });
    showDraft();
  });
  listen(form, 'submit', event => {
    event.preventDefault();
  });
  listen(reset, 'click', () => {
    select({ status: [], created: null, from: null, to: null });
  });
  for (const [key, control] of Object.entries(order)) listen(control, 'change', () => {
    try {
      if (key === 'sort') {
        const [sort, direction] = control.value.split(':');
        select({ sort, direction });
      } else select({ limit: Number(control.value) });
    } catch (error) {
      control.value = key === 'sort' ? `${session.applied.sort}:${session.applied.direction}` : String(session.applied[key]);
      orderNotice.textContent = error instanceof SelectionError ? error.message : 'The table could not be updated.';
    }
  });
  for (const button of headers) listen(button, 'click', () => {
    const sort = button.dataset.sort;
    const descendingFirst = ['execution_id', 'created_at', 'started_at', 'ended_at',
      'duration_seconds', 'warning_count', 'error_count'].includes(sort);
    if (session.applied && metadata.execution_sorts.includes(sort)) select({ sort,
      direction: session.applied.sort === sort ? (session.applied.direction === 'asc' ? 'desc' : 'asc')
        : descendingFirst ? 'desc' : 'asc' });
  });
  function restore({ reusePage = true } = {}) {
    close({ commitStatus: false });
    try {
      const selection = session.restore(window.location.search);
      fieldset.disabled = false; reset.disabled = false; recover.hidden = true;
      for (const control of Object.values(order)) control.disabled = false;
      showDraft(); writeUrl(selection, true); showApplied(selection, { restore: reusePage });
    } catch (error) {
      fieldset.disabled = true; recover.hidden = false;
      for (const control of Object.values(order)) control.disabled = true;
      for (const button of headers) button.disabled = true;
      orderNotice.textContent = '';
      notice.textContent = `${error instanceof SelectionError ? error.message : 'Filters could not be restored.'} Reset invalid filters to start again.`;
      onApplied(null);
    }
  }
  listen(recover, 'click', () => { window.history.replaceState(null, '', appBase); restore({ reusePage: false }); });
  listen(window, 'popstate', restore);
  restore();
  return { select, dispose() {
    close({ commitStatus: false }); clearTimeout(searchTimer); range.cancel();
    for (const owner of pickers.values()) owner.dispose();
    for (const control of Object.values(order)) control.disabled = true;
    for (const button of headers) button.disabled = true;
    for (const remove of removers) remove();
  } };
}
