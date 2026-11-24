import { mountBootstrap } from './bootstrap.js';
import { mountHistory } from './render-history.js';
import { createHistoryLoader } from './history-loader.js';
import { historyHref, historySelection, parseHistorySelection, scopedHistorySelection } from './history-navigation.js';
import { defaultSelection, withPackageExtension } from './selection.js';
import { inlineStatus, pollingButton } from './ui.js';
import { createDisplay, observationTitle, refreshStatus } from './display.js';
import { readRefreshPause, refreshPauseState, saveRefreshPause } from './refresh-pause.js';
const invalid = 'Invalid history link. Enter names or patterns and choose Load history.';
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
    let selection = parseHistorySelection('', metadata), paused = saved ? saved.paused === true : readRefreshPause(window);
    const controls = Object.fromEntries(['match', 'folder', 'project', 'package'].map(key => [key, form.elements.namedItem(key)]));
    const show = () => { for (const [key, input] of Object.entries(controls)) input.value = selection[key]; };
    let loaded = false, persistent = '', shown = null;
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
    // The tab names the loaded package scope; idle and invalid pages use the plain title.
    const showTitle = () => {
      document.title = loaded ? `History · ${selection.package} · SSIS Dashboard` : 'History · SSIS Dashboard';
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
        loaded = true; showIdle(false); showTitle();
        if (push) window.history.pushState(refreshPauseState(paused), '', historyHref(selection, navigation));
        shown = window.location.search;
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
        const generatedAt = state.page?.meta.generated_at;
        const [text, mode] = refreshStatus(display, generatedAt, state.poll);
        inlineStatus(status, text, [mode, observationTitle(display, generatedAt)].filter(Boolean).join(' · '));
        pollingButton(toggle, state.poll.paused);
        paused = state.poll.paused;
        refresh.setAttribute('aria-disabled', String(state.busy));
      } });
    const submit = event => {
      event.preventDefault();
      const draft = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value]));
      // Only an edited exact name gets the extension; a name restored from a link is kept as it was.
      const unchanged = selection.match === 'exact' && draft.package === selection.package;
      if (draft.match === 'exact' && !unchanged) draft.package = withPackageExtension(draft.package);
      select({ ...selection, ...draft });
    };
    // Without a valid scope, offer an empty Exact form and wait for Load history. URLs without match= keep meaning LIKE.
    const pop = event => {
      // The live pause outlasts scope changes; record it on the entry Back or Forward landed on.
      if (event) saveRefreshPause(window, paused);
      const search = window.location.search;
      // A fragment-only history entry keeps the same query: nothing to reload.
      if (event && search === shown) return;
      shown = search;
      persistent = '';
      let scoped = null;
      try { scoped = scopedHistorySelection(search, metadata); } catch { persistent = invalid; }
      selection = scoped ?? parseHistorySelection('', metadata);
      navigation.historySelection = selection; show();
      loaded = scoped !== null;
      showTitle();
      if (loaded) { showIdle(false); void owner.select(selection); }
      else {
        // An invalid link is not shown as a wildcard draft: an unedited Load history must not search every package.
        showIdle(true); owner.clear();
        controls.match.value = 'exact';
        for (const key of ['folder', 'project', 'package']) controls[key].value = '';
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
    const update = () => owner.refresh();
    const pause = () => {
      owner.togglePolling();
      saveRefreshPause(window, paused);
    };
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
