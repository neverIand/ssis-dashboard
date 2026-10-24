import { formatCode } from './display.js';
import { createCatalogSearch } from './catalog-search.js';
import { mountRangeEditor } from './range-editor.js';
import { catalogName, createSelectionSession, SelectionError, selectionSearch } from './selection.js';
import { rangeLabel } from './time-range.js';

export function mountFilters(root, { metadata, api, appBase, onApplied = () => {} }) {
  const document = root.ownerDocument, window = document.defaultView;
  const form = root.querySelector('#overview-filters');
  const get = selector => form.querySelector(selector);
  const fieldset = get('fieldset'), notice = get('[data-filter-notice]');
  const apply = get('[data-apply-filters]'), reset = get('[data-reset-filters]');
  const recover = get('[data-recover-filters]'), status = get('#status');
  const order = Object.fromEntries(['sort', 'direction', 'limit']
    .map(key => [key, root.querySelector(`[data-order="${key}"]`)]));
  const orderNotice = root.querySelector('[data-order-notice]');
  const session = createSelectionSession(metadata), removers = [];
  const pickers = new Map();
  let opened = null, searchTimer = null;
  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    removers.push(() => element.removeEventListener(event, handler));
  }
  order.sort.replaceChildren(...metadata.execution_sorts.map(key => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = ({ execution_id: 'ID', created_at: 'Created', started_at: 'Started', ended_at: 'Ended',
      project_name: 'Project', package_name: 'Entry package', environment: 'Environment', status: 'Status',
      logging_level: 'Logging level', duration_seconds: 'Duration', warning_count: 'Warnings', error_count: 'Errors' })[key] ?? key;
    return option;
  }));
  order.limit.max = String(metadata.limits.max_limit);

  function close({ focus = false } = {}) {
    if (!opened) return;
    clearTimeout(searchTimer);
    const { panel, trigger, key } = opened;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    pickers.get(key)?.cancel();
    if (key === 'created') range.cancel();
    opened = null;
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
    apply.disabled = !changed;
    notice.textContent = changed ? 'Changes not applied.' : '';
  }
  function showApplied(selection, options) {
    for (const [key, control] of Object.entries(order)) control.value = String(selection[key]);
    orderNotice.textContent = '';
    onApplied(selection, options);
  }
  function writeUrl(selection, replace = false) {
    const url = appBase + selectionSearch(selection, metadata) + window.location.hash;
    if (replace) window.history.replaceState(null, '', url);
    else if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(null, '', url);
  }
  function chooseScope(key, name) {
    try {
      if (name !== null) catalogName(name);
      const selection = session.scope({ [key]: name });
      close({ focus: true });
      writeUrl(selection);
      showDraft();
      showApplied(selection);
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

  const range = mountRangeEditor(form, { metadata, api, listen, onChoose(bounds) {
    session.update(bounds); close({ focus: true }); showDraft();
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
    } else if (key === 'created') { range.open(session.draft); get('#creation-window').focus(); }
    else status.querySelector('input').focus();
    position();
  });
  for (const button of form.querySelectorAll('[data-close-filter]')) listen(button, 'click', () => close({ focus: true }));
  listen(document, 'pointerdown', event => {
    if (opened && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) close();
  });
  listen(form, 'keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); close({ focus: true }); }
    else if (event.key === 'Enter' && opened && event.target.tagName === 'INPUT') event.preventDefault();
  });
  listen(document, 'focusin', event => {
    if (opened && !opened.panel.contains(event.target) && !opened.trigger.contains(event.target)) close();
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
    if (opened || session.applied === null) return;
    try {
      const selection = session.apply();
      writeUrl(selection); showDraft(); showApplied(selection);
    } catch (error) { notice.textContent = error instanceof SelectionError ? error.message : 'Filters could not be applied.'; }
  });
  listen(reset, 'click', () => {
    close(); session.update({ status: [], from: null, to: null });
    const selection = session.apply();
    writeUrl(selection); showDraft(); showApplied(selection);
  });
  for (const [key, control] of Object.entries(order)) listen(control, 'change', () => {
    try {
      const selection = session.order({ [key]: key === 'limit' ? Number(control.value) : control.value });
      writeUrl(selection); showDraft(); showApplied(selection);
    } catch (error) {
      control.value = String(session.applied[key]);
      orderNotice.textContent = error instanceof SelectionError ? error.message : 'The table could not be updated.';
    }
  });
  function restore({ reusePage = true } = {}) {
    close();
    try {
      const selection = session.restore(window.location.search);
      fieldset.disabled = false; reset.disabled = false; recover.hidden = true;
      for (const control of Object.values(order)) control.disabled = false;
      showDraft(); writeUrl(selection, true); showApplied(selection, { restore: reusePage });
    } catch (error) {
      fieldset.disabled = true; apply.disabled = true; recover.hidden = false;
      for (const control of Object.values(order)) control.disabled = true;
      orderNotice.textContent = '';
      notice.textContent = `${error instanceof SelectionError ? error.message : 'Filters could not be restored.'} Reset invalid filters to start again.`;
      onApplied(null);
    }
  }
  listen(recover, 'click', () => { window.history.replaceState(null, '', appBase); restore({ reusePage: false }); });
  listen(window, 'popstate', restore);
  restore();
  return () => {
    close(); clearTimeout(searchTimer); range.cancel();
    for (const owner of pickers.values()) owner.dispose();
    for (const control of Object.values(order)) control.disabled = true;
    for (const remove of removers) remove();
  };
}
