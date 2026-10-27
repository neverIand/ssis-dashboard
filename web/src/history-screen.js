import { mountBootstrap } from './bootstrap.js';
import { mountHistory } from './render-history.js';
import { createHistoryLoader } from './history-loader.js';
import { historyHref, historySelection, parseHistorySelection } from './history-navigation.js';
import { defaultSelection } from './selection.js';
import { inlineStatus, pollingButton } from './ui.js';
import { createDisplay, refreshStatus } from './display.js';
const invalid = 'Invalid history filters. Review the selection and choose Load history.';

export function mountHistoryScreen(root, saved = null) {
  const window = root.ownerDocument.defaultView, document = root.ownerDocument;
  let checkpoint = () => null;
  const dispose = mountBootstrap(root, { ready(metadata, api, config) {
    const display = createDisplay({ timeZone: metadata.display_timezone });
    const form = root.querySelector('[data-history-scope-form]'), fields = root.querySelector('[data-history-scope]');
    const notice = root.querySelector('[data-history-scope-notice]'), refresh = root.querySelector('[data-history-refresh]');
    const toggle = root.querySelector('[data-history-poll-toggle]'), status = root.querySelector('[data-history-poll-status]');
    const navigation = { appBase: config.app_base, origin: window.location.origin, metadata,
      selection: defaultSelection(metadata), historySelection: null };
    let selection, valid = true, paused = saved?.paused === true;
    try { selection = parseHistorySelection(window.location.search, metadata); }
    catch { selection = parseHistorySelection('', metadata); valid = false; }
    const controls = Object.fromEntries(['match', 'folder', 'project', 'package'].map(key => [key, form.elements.namedItem(key)]));
    const show = () => { for (const [key, input] of Object.entries(controls)) input.value = selection[key]; };
    show(); fields.disabled = false; refresh.disabled = toggle.disabled = false;
    if (!valid) notice.textContent = invalid;
    const select = (value, push = true) => {
      try {
        selection = historySelection(value, metadata); navigation.historySelection = selection; show(); notice.textContent = '';
        if (push) window.history.pushState(null, '', historyHref(selection, navigation));
        void owner.select(selection);
      } catch { notice.textContent = 'Enter valid history names or patterns and choose a supported row limit.'; }
    };
    const view = mountHistory(root, { metadata, executionId: null, navigation, showIdentity: true, restoreView: saved?.view,
      actions: { toggle() {}, order: changes => select({ ...selection, ...changes }),
        retry: () => owner.retry(), previous: () => owner.previous(), next: () => owner.next(), latest: () => owner.latest() } });
    navigation.historySelection = selection;
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
    const pop = () => {
      try { select(parseHistorySelection(window.location.search, metadata), false); }
      catch { owner.clear(); notice.textContent = invalid; }
    };
    const update = () => owner.refresh(), pause = () => owner.togglePolling();
    const visibility = () => owner.setVisible(document.visibilityState !== 'hidden');
    form.addEventListener('submit', submit); refresh.addEventListener('click', update); toggle.addEventListener('click', pause);
    window.addEventListener('popstate', pop); document.addEventListener('visibilitychange', visibility);
    checkpoint = () => ({ paused, view: view.checkpoint() });
    if (valid) void owner.load();
    else owner.clear();
    return () => {
      owner.dispose(); view.dispose(); checkpoint = () => null;
      form.removeEventListener('submit', submit); refresh.removeEventListener('click', update);
      toggle.removeEventListener('click', pause); window.removeEventListener('popstate', pop);
      document.removeEventListener('visibilitychange', visibility);
    };
  } });
  return { dispose, checkpoint: () => checkpoint() };
}
