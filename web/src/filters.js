import { formatCode } from './display.js';
import { createNavigation } from './navigation.js';
import { catalogName, createSelectionSession, SelectionError, selectionSearch } from './selection.js';

export function mountFilters(root, { metadata, api, appBase, onApplied = () => {} }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const form = root.querySelector('#overview-filters');
  const fieldset = form.querySelector('fieldset');
  const input = Object.fromEntries(['folder', 'project', 'status', 'creation-window', 'from', 'to']
    .map((name) => [name, form.querySelector(`#${name}`)]));
  const custom = form.querySelector('[data-custom-window]');
  const notice = form.querySelector('[data-filter-notice]');
  const appliedText = form.querySelector('[data-applied-selection]');
  const reset = form.querySelector('[data-reset-filters]');
  const apply = form.querySelector('[data-apply-filters]');
  const session = createSelectionSession(metadata);
  const removeListeners = [];
  let projectFolder = null;
  let foldersStarted = false;

  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    removeListeners.push(() => element.removeEventListener(event, handler));
  }

  function navigation(kind) {
    const container = form.querySelector(`[data-navigation="${kind}"]`);
    const choices = form.querySelector(`#${kind === 'folders' ? 'folder' : 'project'}-options`);
    const message = container.querySelector('[role="status"]');
    const previous = container.querySelector('[data-previous]');
    const next = container.querySelector('[data-next]');
    const retry = container.querySelector('[data-navigation-retry]');
    const owner = createNavigation({ api, kind, limit: metadata.limits.default_limit,
      publish(state) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose from this page';
        choices.replaceChildren(placeholder, ...state.rows.map((row) => {
          const option = document.createElement('option');
          option.value = row.name;
          option.textContent = row.name;
          return option;
        }));
        choices.disabled = state.phase !== 'ready' || !state.rows.length;
        previous.disabled = !state.hasPrevious;
        next.disabled = !state.hasNext;
        retry.hidden = state.phase !== 'error';
        message.textContent = state.phase === 'loading' ? `Loading ${kind}…`
          : state.phase === 'idle' ? (kind === 'projects' ? 'Choose a folder to browse projects.' : '')
          : state.phase === 'error' ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}`
          : `Page ${state.page} · ${state.rows.length} ${kind}`;
        if (state.phase === 'error' && ['invalid_cursor', 'cursor_expired'].includes(state.error.code)) {
          message.textContent = 'Choices expired. Retry starts at page one.';
        }
      } });
    listen(previous, 'click', () => { void owner.previous(); });
    listen(next, 'click', () => { void owner.next(); });
    listen(retry, 'click', () => { void owner.retry(); });
    listen(choices, 'change', () => {
      if (!choices.value) return;
      input[kind === 'folders' ? 'folder' : 'project'].value = choices.value;
      if (kind === 'folders') { folderEdited(); loadProjects(); }
      else changed();
    });
    return owner;
  }

  const folders = navigation('folders');
  const projects = navigation('projects');

  function loadProjects() {
    const folder = input.folder.value || null;
    if (folder === projectFolder) return;
    projectFolder = folder;
    try { if (folder !== null) catalogName(folder); }
    catch { projectFolder = null; projects.clear(); return; }
    void projects.reset(folder);
  }

  function readDraft() {
    const folder = input.folder.value || null;
    if (folder !== session.draft.folder) input.project.value = '';
    session.update({ folder });
    session.update({ project: input.project.value || null,
      status: [...input.status.querySelectorAll('input:checked')].filter((checkbox) => checkbox.value !== '')
        .map((checkbox) => Number(checkbox.value)).sort((a, b) => a - b),
      from: input['creation-window'].value === 'custom' ? input.from.value || null : null,
      to: input['creation-window'].value === 'custom' ? input.to.value || null : null });
  }

  function changed() {
    readDraft();
    for (const key of ['folder', 'project']) {
      const choices = form.querySelector(`#${key}-options`);
      if (choices.value !== input[key].value) choices.value = '';
    }
    notice.textContent = JSON.stringify(session.draft) === JSON.stringify(session.applied) ? '' : 'Changes not applied.';
  }

  function showDraft() {
    const selection = session.draft;
    for (const key of ['folder', 'project', 'from', 'to']) input[key].value = selection[key] ?? '';
    for (const key of ['folder', 'project']) form.querySelector(`#${key}-options`).value = '';
    for (const checkbox of input.status.querySelectorAll('input')) {
      checkbox.checked = checkbox.value === '' ? selection.status.length === 0 : selection.status.includes(Number(checkbox.value));
    }
    input['creation-window'].value = selection.from !== null || selection.to !== null ? 'custom' : 'default';
    custom.hidden = input['creation-window'].value !== 'custom';
  }

  function showApplied(selection) {
    const status = selection.status.length ? metadata.execution_statuses
      .filter((item) => selection.status.includes(item.code)).map(formatCode).join(', ') : 'All statuses';
    const windowText = selection.from !== null || selection.to !== null
      ? `${selection.from ?? 'Default start'} → ${selection.to ?? 'Default end'}` : 'Default window';
    appliedText.textContent = `Applied: ${selection.folder ?? 'All folders'} / ${selection.project ?? 'All projects'} · ${status} · ${windowText}`;
    appliedText.hidden = false;
    onApplied(selection);
  }

  function writeUrl(selection, replace) {
    const url = appBase + selectionSearch(selection, metadata) + window.location.hash;
    if (replace) window.history.replaceState(null, '', url);
    else if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(null, '', url);
    }
  }

  function restore() {
    reset.disabled = false;
    try {
      const selection = session.restore(window.location.search);
      fieldset.disabled = false;
      apply.disabled = false;
      showDraft();
      notice.textContent = '';
      writeUrl(selection, true);
      showApplied(selection);
      if (!foldersStarted) { foldersStarted = true; void folders.reset(); }
      loadProjects();
      if (selection.folder === null) projects.clear();
    } catch (error) {
      fieldset.disabled = true;
      apply.disabled = true;
      appliedText.hidden = true;
      notice.textContent = `${error instanceof SelectionError ? error.message : 'Filters could not be restored.'} Reset filters to start again.`;
      folders.clear();
      projects.clear();
      foldersStarted = false;
      projectFolder = null;
      onApplied(null);
    }
  }

  function folderEdited() {
    changed();
    projectFolder = null;
    projects.clear();
  }
  listen(input.folder, 'input', folderEdited);
  listen(input.folder, 'change', loadProjects);
  listen(input.folder, 'blur', loadProjects);
  for (const key of ['project', 'from', 'to']) listen(input[key], 'input', changed);
  listen(input['creation-window'], 'change', () => {
    custom.hidden = input['creation-window'].value !== 'custom';
    changed();
  });
  listen(input.status, 'change', (event) => {
    const all = input.status.querySelector('input[value=""]');
    const codes = [...input.status.querySelectorAll('input')].filter((checkbox) => checkbox.value !== '');
    if (event.target === all && all.checked) for (const checkbox of codes) checkbox.checked = false;
    else if (event.target !== all && event.target.checked) all.checked = false;
    if (!codes.some((checkbox) => checkbox.checked)) all.checked = true;
    changed();
  });
  listen(form, 'submit', (event) => {
    event.preventDefault();
    readDraft();
    try {
      if (input['creation-window'].value === 'custom' && !session.draft.from && !session.draft.to) {
        throw new SelectionError('Enter at least one time bound or choose Default window.');
      }
      const selection = session.apply();
      writeUrl(selection, false);
      showApplied(selection);
      notice.textContent = 'Filters applied.';
      loadProjects();
    } catch (error) { notice.textContent = error instanceof SelectionError ? error.message : 'Filters could not be applied.'; }
  });
  listen(reset, 'click', () => {
    window.history.replaceState(null, '', appBase);
    restore();
  });
  listen(window, 'popstate', restore);
  restore();
  return () => {
    folders.dispose();
    projects.dispose();
    for (const remove of removeListeners) remove();
  };
}
