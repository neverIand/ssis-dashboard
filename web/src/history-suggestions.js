import { createCatalogSearch } from './catalog-search.js';
import { errorLabel } from './display.js';
import { modified } from './ui.js';

const step = 5;

// Name suggestions for one History scope field in Exact mode: the first five matching catalog names,
// then at most five more per Load more. Focus stays in the field (aria-activedescendant); choosing a
// name only fills the field, and Load history still applies it. LIKE mode makes it a plain text box.
// `controls` are the form's match, folder, project and package fields; `key` names this one.
export function mountSuggestions({ api, metadata, key, controls, panel, changed }) {
  const input = controls[key], kind = `${key}s`, document = input.ownerDocument;
  const enabled = () => controls.match.value === 'exact';
  const [list, status, more] = ['list', 'status', 'more'].map(part => panel.querySelector(`[data-suggestion-${part}]`));
  // `going`: Load more, Search more or Retry is reading, so its button stays in place (disabled).
  let shown, state, active, timer, open = false, going;
  const aria = { role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false' };
  const owner = createCatalogSearch({ api, kind, limit: step, maxLimit: metadata.limits.max_limit,
    publish(next) { state = next; render(); } });
  const visible = () => state?.rows.slice(0, shown) ?? [];
  // The list counts as expanded only while it has options.
  const expand = some => { list.hidden = !some; input.setAttribute('aria-expanded', !!some); };
  const prevent = event => event.preventDefault();
  // Never leave focus on a hidden option or button.
  const home = () => panel.contains(document.activeElement) && input.focus();
  function setActive(index) {
    const options = [...list.children];
    active = Math.max(-1, Math.min(index, options.length - 1));
    options.forEach((option, position) => option.setAttribute('aria-selected', String(position === active)));
    if (active < 0) input.removeAttribute('aria-activedescendant');
    else { input.setAttribute('aria-activedescendant', options[active].id); options[active].scrollIntoView?.({ block: 'nearest' }); }
  }
  function render() {
    if (!open || !state) return;
    const rows = visible(), { phase, complete } = state, failed = phase === 'error', loading = phase === 'loading';
    list.replaceChildren(...rows.map((row, index) => {
      const option = document.createElement('li');
      Object.assign(option, { id: `${list.id}-${index}`, textContent: row.name });
      option.setAttribute('role', 'option');
      option.addEventListener('pointerdown', prevent);
      option.addEventListener('click', () => choose(row.name));
      return option;
    }));
    const hidden = !failed && !(loading && going)
      && (phase === 'idle' || (loading && !rows.length) || (complete && state.rows.length <= shown));
    if (hidden) home();
    more.hidden = hidden;
    more.setAttribute('aria-disabled', String(loading));
    more.textContent = failed ? 'Retry' : state.rows.length > shown || !input.value.trim() ? 'Load more' : 'Search more';
    status.textContent = phase === 'idle' ? `Enter a folder${kind === 'packages' ? ' and a project' : ''} first.`
      : failed ? errorLabel(state.error) : rows.length ? '' : loading ? 'Loading…'
      : complete ? 'No matching names.' : 'No matches yet.';
    going &&= loading;
    expand(rows.length);
    setActive(Math.min(active, rows.length - 1));
  }
  // Forget the shown names at once: nothing listed before a change of text can be chosen after it.
  function reset() {
    clearTimeout(timer); owner.cancel();
    state = null; going = false; shown = step; list.replaceChildren(); setActive(-1); expand(0);
    status.textContent = 'Loading…'; more.hidden = true;
  }
  function show() {
    if (!enabled()) return;
    reset();
    open = true; panel.hidden = false;
    void owner.search(input.value.trim(), controls.folder.value || null, controls.project.value || null);
  }
  function hide() {
    home();
    reset();
    open = false; panel.hidden = true;
    for (const name in aria) enabled() ? input.setAttribute(name, aria[name]) : input.removeAttribute(name);
  }
  // A chosen name fills the field as a draft, like typed text.
  const choose = name => { hide(); input.value = name; changed(); };
  // Late input or composition events after the field lost focus do not reopen the list.
  const typed = event => {
    if (event.isComposing || document.activeElement !== input) return;
    reset();
    if (enabled()) timer = setTimeout(show, 250); else hide();
  };
  const escape = event => { prevent(event); event.stopPropagation(); hide(); };
  const leave = event => { if (!panel.contains(event.relatedTarget) && event.relatedTarget !== input) hide(); };
  const listeners = [
    // A composition closes the list; its end reads names again.
    [input, 'input', typed], [input, 'compositionstart', hide], [input, 'compositionend', typed],
    [input, 'focusout', leave], [panel, 'focusout', leave],
    [input, 'keydown', event => {
      const count = list.children.length, key = event.key;
      // Input-method keys (choosing a candidate) and modified keys (Shift+arrows selecting text) stay with the browser.
      if (!enabled() || event.isComposing || event.keyCode === 229 || modified(event)) return;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!open) show();
        else if (count) setActive(key === 'ArrowDown' ? (active + 1) % count : active <= 0 ? count - 1 : active - 1);
      } else if (key === 'Enter' && open && active >= 0) {
        event.preventDefault(); choose(visible()[active].name);
      } else if (key === 'Escape') open ? escape(event) : clearTimeout(timer);
    }],
    [panel, 'keydown', event => event.key === 'Escape' && escape(event)],
    // A pointer press opens the list (Tab does not); pressing the button keeps focus in the field, as macOS Safari needs.
    [input, 'pointerup', () => { if (!open) show(); }], [more, 'pointerdown', prevent],
    [more, 'click', () => {
      if (!state || state.phase === 'loading') return;
      going = true;
      if (state.phase === 'error') return void owner.retry();
      // At most five more names than are shown now, however many pages the scan reads.
      shown = visible().length + step;
      if (state.rows.length < shown && !state.complete) void owner.more(); else { going = false; render(); }
    }],
  ];
  const stop = new AbortController();
  for (const [target, type, handler] of listeners) target.addEventListener(type, handler, { signal: stop.signal });
  hide();
  return { hide, dispose() { hide(); owner.dispose(); stop.abort(); } };
}
