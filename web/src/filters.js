import { errorLabel, formatCode } from './display.js';
import { createCatalogSearch } from './catalog-search.js';
import { executionHref, readDetailFragment } from './detail-navigation.js';
import { mountRangeEditor } from './range-editor.js';
import { readRefreshPause, refreshPauseState, saveRefreshPause } from './refresh-pause.js';
import { catalogName, createSelectionSession, packageNameUnits, SelectionError, selectionSearch, validateSelection }
  from './selection.js';
import { rangeLabel } from './time-range.js';
import { positionPopover } from './ui.js';

// Enter that confirms an input-method candidate (isComposing, or keyCode 229) is not a submit.
const submitKey = event => event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;

export function mountFilters(root, { metadata, api, appBase, onApplied = () => {}, effectiveWindow = () => null,
  isRefreshPaused }) {
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
  const geometry = new window.ResizeObserver(position);
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
  function close({ focus = false, commitStatus = true, hide = true } = {}) {
    if (!opened) return;
    clearTimeout(searchTimer);
    const { panel, trigger, key } = opened;
    opened = null;
    if (hide) panel.hidePopover();
    pickers.get(key)?.cancel();
    if (key === 'created') range.cancel();
    if (key === 'status' && commitStatus) commit();
    if (focus) trigger.focus();
  }
  function position() {
    if (opened?.panel.matches(':popover-open')) positionPopover(opened.panel, opened.trigger);
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
    label('package', draft.package ?? 'All packages');
    for (const checkbox of status.querySelectorAll('input')) {
      checkbox.checked = checkbox.value === '' ? !draft.status.length : draft.status.includes(Number(checkbox.value));
    }
    const names = metadata.execution_statuses.filter(item => draft.status.includes(item.code)).map(formatCode);
    label('status', names.length ? names.join(', ') : 'All statuses');
    label('created', rangeLabel(draft, metadata.display_timezone, metadata.limits.default_range_hours));
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
    if (replace) window.history.replaceState(window.history.state, '', url);
    else if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(refreshPauseState(isRefreshPaused?.() ?? readRefreshPause(window)), '', url);
    }
  }
  function chooseScope(key, name) {
    try {
      if (name !== null) catalogName(name, key === 'package' ? packageNameUnits : undefined);
      const trigger = opened?.trigger;
      select({ [key]: name });
      trigger?.focus();
    } catch (error) {
      const message = error instanceof SelectionError ? error.message : 'Scope could not be changed.';
      if (key === 'package') packageStatus.textContent = message; else notice.textContent = message;
    }
  }
  function mountClearButton(key, input) {
    const button = get(`[data-clear-picker="${key}"]`);
    const sync = () => { button.hidden = !input.value; };
    listen(input, 'input', sync);
    listen(button, 'click', () => {
      input.value = '';
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return value => { input.value = value; sync(); };
  }

  // Package has no catalog list operation, so its panel takes an exact name only.
  // Folder and project changes keep it: the same name may need narrowing to one project.
  const packageName = get('#package-name'), packageStatus = get('[data-package-status]');
  const setPackageName = mountClearButton('package', packageName);
  // A single-line box drops CR/LF. Keep the exact name on an unedited, nonempty Apply.
  let packageEdited = false;
  function applyPackage() {
    const name = packageEdited ? packageName.value : session.applied.package;
    chooseScope('package', packageName.value ? name : null);
  }
  listen(get('[data-apply-package]'), 'click', applyPackage);
  listen(packageName, 'keydown', event => { if (submitKey(event)) { event.preventDefault(); applyPackage(); } });
  listen(packageName, 'input', () => { packageEdited = true; packageStatus.textContent = ''; });

  for (const key of ['folder', 'project']) {
    const search = get(`#${key}-search`), choices = get(`[data-catalog-choices="${key}"]`);
    const message = get(`[data-catalog-status="${key}"]`), more = get(`[data-catalog-more="${key}"]`);
    const retry = get(`[data-catalog-retry="${key}"]`), exact = get(`[data-exact-scope="${key}"]`);
    const all = get(`[data-all-scope="${key}"]`), setSearch = mountClearButton(key, search);
    const owner = createCatalogSearch({ api, kind: `${key}s`, limit: metadata.limits.default_limit,
      maxLimit: metadata.limits.max_limit,
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
        message.textContent = state.phase === 'idle'
          ? 'Choose a folder to browse projects, or enter an exact project name across all folders.'
          : state.phase === 'loading' ? (search.value ? 'Searching the catalog…' : 'Loading…')
          : state.phase === 'error' ? errorLabel(state.error)
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
    const searchNow = () => { void owner.search(search.value, key === 'project' ? session.applied.folder : null); };
    pickers.set(key, {
      cancel: owner.cancel, dispose: owner.dispose,
      open() {
        setSearch(''); exact.hidden = true;
        all.setAttribute('aria-pressed', String(session.applied[key] === null));
        searchNow();
      }
    });
    listen(search, 'input', () => {
      owner.cancel(); clearTimeout(searchTimer);
      choices.replaceChildren(); more.hidden = true; retry.hidden = true;
      message.textContent = 'Searching…';
      exact.hidden = !search.value;
      searchTimer = setTimeout(searchNow, 250);
    });
    listen(search, 'keydown', event => {
      if (submitKey(event)) { event.preventDefault(); clearTimeout(searchTimer); searchNow(); }
      else if (event.key === 'ArrowDown' && choices.children.length) { event.preventDefault(); choices.children[0].focus(); }
    });
    // ArrowDown/ArrowUp move through the choices; ArrowUp from the first returns to the search box.
    listen(choices, 'keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...choices.children], index = items.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      (event.key === 'ArrowDown' ? items[index + 1] : items[index - 1] ?? search)?.focus();
    });
    listen(more, 'click', () => { void owner.more(); });
    listen(retry, 'click', () => { void owner.retry(); });
    listen(exact, 'click', () => chooseScope(key, search.value));
    listen(all, 'click', () => chooseScope(key, null));
  }

  const range = mountRangeEditor(form, { metadata, listen, onChoose(bounds) {
    const trigger = opened?.trigger;
    select(bounds); trigger?.focus();
  } });
  for (const trigger of form.querySelectorAll('[data-open-filter]')) {
    const key = trigger.dataset.openFilter;
    const panel = get(`[data-filter-panel="${key}"]`);
    const picker = pickers.get(key);
    geometry.observe(panel);
    listen(panel, 'beforetoggle', event => {
      if (event.newState === 'closed') {
        // Native light dismiss runs before click. Selection actions must consume the draft first.
        if (opened?.panel === panel && !opened.activation) close({ hide: false });
        return;
      }
      if (session.applied === null) { event.preventDefault(); return; }
      if (opened?.panel === panel) return;
      close();
      opened = { key, trigger, panel, activation: null };
      if (picker) picker.open();
      else if (key === 'package') {
        setPackageName(session.applied.package ?? ''); packageStatus.textContent = ''; packageEdited = false;
      } else if (key === 'created') range.open(session.draft, effectiveWindow());
    });
    listen(panel, 'toggle', position);
  }
  listen(packageName, 'focus', () => packageName.select?.());
  listen(document, 'pointerdown', event => {
    if (opened?.key === 'status') {
      opened.activation = event.target.closest?.(
        '[data-selection-link], [data-selection-action], [data-sort], [data-execution-link]');
    }
  });
  listen(document, 'pointercancel', () => { if (opened) opened.activation = null; });
  function outsideClick(event) {
    if (!opened || opened.panel.contains(event.target) || opened.trigger.contains(event.target)) return;
    // Keep a first chart click's draft visible without taking focus from the double-click target.
    if (opened.key === 'status' && event.target.closest?.('[data-selection-action]')) {
      opened.activation = null;
      const first = status.querySelector('input');
      first.autofocus = false;
      opened.panel.showPopover();
      first.autofocus = true;
      return;
    }
    const link = event.target.closest?.('[data-execution-link]');
    if (opened.key === 'status' && link) {
      // Update the activated anchor before committing clears rows.
      link.setAttribute('href', executionHref(link.dataset.executionId,
        validateSelection(session.draft, metadata), { metadata, appBase, origin: window.location.origin,
          section: readDetailFragment(new URL(link.href, window.location.origin).hash, metadata) }));
    }
    close();
  }
  listen(document, 'click', outsideClick);
  listen(document, 'auxclick', outsideClick);
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && opened?.key === 'status') {
      event.preventDefault();
      session.update({ status: session.applied.status }); showDraft();
      close({ focus: true, commitStatus: false });
    }
  });
  listen(form, 'keydown', event => {
    if (submitKey(event) && opened && event.target.tagName === 'INPUT') event.preventDefault();
  });
  listen(document, 'focusin', event => {
    if (opened && !opened.activation && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) {
      close();
    }
  });
  listen(window, 'resize', position);
  listen(document, 'scroll', position);
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
      notice.textContent = `${error instanceof SelectionError ? error.message
        : 'Filters could not be restored.'} Reset invalid filters to start again.`;
      onApplied(null);
    }
  }
  listen(recover, 'click', () => { window.history.replaceState(window.history.state, '', appBase); restore({ reusePage: false }); });
  // A fragment-only history entry leaves the applied selection in place: nothing to restore or reload.
  listen(window, 'popstate', () => {
    // The live pause outlasts selection changes; record it on the entry Back or Forward landed on.
    if (isRefreshPaused) saveRefreshPause(window, isRefreshPaused());
    if (session.applied === null || window.location.search !== selectionSearch(session.applied, metadata)) restore();
  });
  restore();
  return { select, dispose() {
    geometry.disconnect();
    close({ commitStatus: false }); clearTimeout(searchTimer); range.cancel();
    for (const owner of pickers.values()) owner.dispose();
    for (const control of Object.values(order)) control.disabled = true;
    for (const button of headers) button.disabled = true;
    for (const remove of removers) remove();
  } };
}
