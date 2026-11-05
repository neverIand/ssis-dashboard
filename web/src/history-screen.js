import { mountBootstrap } from './bootstrap.js';
import { mountHistory } from './render-history.js';
import { createHistoryLoader } from './history-loader.js';
import { historyHref, historySelection, parseHistorySelection } from './history-navigation.js';
import { defaultSelection } from './selection.js';
import { inlineStatus, pollingButton } from './ui.js';
import { createDisplay, refreshStatus } from './display.js';
const invalid = 'Invalid history filters. Review the selection and choose Load history.';
const idleText = 'Enter a package name and choose Load history, or open History from an execution.';
const modeNotes = {
  exact: 'Exact names: each field must match the catalog name exactly. All creation dates.',
  like: 'LIKE patterns: * or % matches any text, _ matches one character, [abc] matches a set. All creation dates.',
};

export function mountHistoryScreen(root, saved = null) {
  const window = root.ownerDocument.defaultView, document = root.ownerDocument;
  let checkpoint = () => null;
  const dispose = mountBootstrap(root, { ready(metadata, api, config) {
    const display = createDisplay({ timeZone: metadata.display_timezone });
    const form = root.querySelector('[data-history-scope-form]'), fields = root.querySelector('[data-history-scope]');
    const notice = root.querySelector('[data-history-scope-notice]'), refresh = root.querySelector('[data-history-refresh]');
    const toggle = root.querySelector('[data-history-poll-toggle]'), status = root.querySelector('[data-history-poll-status]');
    const results = root.querySelector('[data-history-results]'), modeNote = root.querySelector('[data-history-mode-note]');
    const loadButton = root.querySelector('[data-history-load]');
    const navigation = { appBase: config.app_base, origin: window.location.origin, metadata,
      selection: defaultSelection(metadata), historySelection: null };
    let selection = parseHistorySelection('', metadata), paused = saved?.paused === true;
    const controls = Object.fromEntries(['match', 'folder', 'project', 'package'].map(key => [key, form.elements.namedItem(key)]));
    const show = () => { for (const [key, input] of Object.entries(controls)) input.value = selection[key]; };
    let loaded = false, persistent = '';
    // Scope edits stay drafts until Load history; other actions apply to the loaded scope and say so.
    const draftChanged = () => loaded && Object.entries(controls).some(([key, input]) => input.value !== selection[key]);
    const describeDraft = () => {
      const changed = draftChanged();
      loadButton.className = changed ? 'button-primary' : '';
      const literal = controls.match.value === 'exact'
        && ['folder', 'project', 'package'].some(key => /[*%]/.test(controls[key].value));
      modeNote.textContent = modeNotes[controls.match.value] ?? modeNotes.like;
      notice.textContent = changed ? 'Scope changes are not applied yet. Choose Load history.'
        : literal ? 'Exact names treat * and % as literal characters.' : persistent;
    };
    const showIdle = idle => {
      if (idle) results.setAttribute('data-idle', ''); else results.removeAttribute('data-idle');
      status.hidden = refresh.hidden = toggle.hidden = idle;
    };
    fields.disabled = false; refresh.disabled = toggle.disabled = false;
    const select = (value, push = true, keepDraft = false) => {
      try {
        const drafts = keepDraft ? Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value])) : null;
        selection = historySelection(value, metadata); navigation.historySelection = selection; show();
        notice.textContent = persistent = '';
        if (drafts) for (const [key, input] of Object.entries(controls)) input.value = drafts[key];
        loaded = true; showIdle(false);
        if (push) window.history.pushState(null, '', historyHref(selection, navigation));
        describeDraft();
        void owner.select(selection);
      } catch { notice.textContent = 'Enter valid history names or patterns and choose a supported row limit.'; }
    };
    const view = mountHistory(root, { metadata, executionId: null, navigation, showIdentity: true, restoreView: saved?.view,
      notLoaded: idleText, rememberChart: true,
      // Until a scope is loaded nothing may read: sorting, row limits and status choices wait for Load history.
      actions: { toggle() {}, order: changes => { if (loaded) select({ ...selection, ...changes }, true, true); },
        retry: () => owner.retry(), previous: () => owner.previous(), next: () => owner.next(), latest: () => owner.latest() } });
    const owner = createHistoryLoader({ api, metadata, selection, paused, visible: document.visibilityState !== 'hidden',
      publish(state) {
        view.render(state, state.busy, true);
        inlineStatus(status, refreshStatus(display, state.page?.meta.generated_at, state.poll));
        pollingButton(toggle, state.poll.paused);
        paused = state.poll.paused;
        refresh.setAttribute('aria-disabled', String(state.busy));
      } });
    const submit = event => {
      event.preventDefault(); select({ ...selection, ...Object.fromEntries(Object.entries(controls).map(([key, input]) =>
        [key, input.value])) });
    };
    // Without a scope, offer an empty Exact form and wait for Load history. URLs without match= keep meaning LIKE.
    const pop = () => {
      const search = window.location.search;
      persistent = '';
      try { selection = parseHistorySelection(search, metadata); }
      catch { selection = parseHistorySelection('', metadata); persistent = invalid; }
      navigation.historySelection = selection; show();
      loaded = search.length > 1 && !persistent;
      if (loaded) { showIdle(false); void owner.select(selection); }
      else {
        showIdle(true); owner.clear();
        if (!persistent) {
          controls.match.value = 'exact';
          for (const key of ['folder', 'project', 'package']) controls[key].value = '';
        }
      }
      describeDraft();
    };
    // Switching to Exact drops pure wildcards so a stray * does not become a literal name.
    const modeChanged = () => {
      if (controls.match.value === 'exact') {
        for (const key of ['folder', 'project', 'package']) if (['*', '%'].includes(controls[key].value)) controls[key].value = '';
      }
      describeDraft();
    };
    const update = () => owner.refresh(), pause = () => owner.togglePolling();
    const visibility = () => owner.setVisible(document.visibilityState !== 'hidden');
    form.addEventListener('submit', submit); refresh.addEventListener('click', update); toggle.addEventListener('click', pause);
    form.addEventListener('input', describeDraft); controls.match.addEventListener('change', modeChanged);
    window.addEventListener('popstate', pop); document.addEventListener('visibilitychange', visibility);
    checkpoint = () => ({ paused, view: view.checkpoint() });
    pop();
    return () => {
      owner.dispose(); view.dispose(); checkpoint = () => null;
      form.removeEventListener('submit', submit); refresh.removeEventListener('click', update);
      form.removeEventListener('input', describeDraft); controls.match.removeEventListener('change', modeChanged);
      toggle.removeEventListener('click', pause); window.removeEventListener('popstate', pop);
      document.removeEventListener('visibilitychange', visibility);
    };
  } });
  return { dispose, checkpoint: () => checkpoint() };
}
