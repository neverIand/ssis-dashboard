import { detailTabs, detailFragment, readDetailFragment, defaultDetailTab, tabAllowed } from './detail-navigation.js';

export function mountDetailTabs(root, { metadata, select, revealInitial = true }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const tabs = detailTabs.map(([key, label]) => ({ key, label,
    button: root.querySelector(`[data-${key}-toggle]`), panel: root.querySelector(`[data-detail-tab-panel="${key}"]`) }));
  let current = null;
  let pendingReveal = null;
  const cancelReveal = () => { pendingReveal = null; };
  const canFollow = target => target && tabAllowed(target.tab, metadata)
    && (target.tab !== 'events' || metadata.event_kinds.includes(target.kind ?? 'all'));
  const remember = (target, focus) => {
    pendingReveal = { target, focus, x: window.scrollX, y: window.scrollY, origin: document.activeElement };
  };
  const initial = readDetailFragment(window.location.hash, metadata);
  if (revealInitial && window.scrollX === 0 && window.scrollY === 0 && canFollow(initial)) remember(initial, false);
  function reveal() {
    if (!pendingReveal || !current) return;
    const { target, focus, x, y, origin } = pendingReveal;
    pendingReveal = null;
    const button = tabs.find(tab => tab.key === target.tab).button;
    if (current.activeTab !== target.tab || (target.tab === 'events'
        && current.events.query.kind !== (target.kind ?? 'all')) || window.scrollX !== x || window.scrollY !== y
        || (document.activeElement !== origin && document.activeElement !== button)) return;
    if (focus) button.focus({ preventScroll: true });
    // No animation, including when reduced motion is requested. Reveal once, after view restoration.
    button.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' });
  }
  function follow(target, { focus = false } = {}) {
    cancelReveal();
    if (!canFollow(target)) return;
    remember(target, focus);
    select(target);
    reveal(); // Selecting an already active category may publish no new state.
  }
  const keyboard = event => {
    const index = tabs.findIndex(tab => tab.button === event.currentTarget);
    const available = tabs.filter(tab => !tab.button.disabled);
    const position = available.indexOf(tabs[index]);
    if (position < 0) return;
    let target;
    if (event.key === 'ArrowRight') target = available[(position + 1) % available.length];
    if (event.key === 'ArrowLeft') target = available[(position + available.length - 1) % available.length];
    if (event.key === 'Home') target = available[0];
    if (event.key === 'End') target = available.at(-1);
    if (!target) return;
    event.preventDefault();
    cancelReveal();
    target.button.focus({ preventScroll: true });
    target.button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    select({ tab: target.key });
  };
  const changed = () => {
    const requested = readDetailFragment(window.location.hash, metadata);
    if (canFollow(requested)) follow(requested);
    else {
      cancelReveal();
      if (current) select(defaultDetailTab(requested, current.response.data.status, metadata));
      else if (requested) select(defaultDetailTab(requested, { code: 0 }, metadata));
    }
    if (current) render(current);
  };
  for (const tab of tabs) tab.button.addEventListener('keydown', keyboard);
  window.addEventListener('hashchange', changed);
  window.addEventListener('scroll', cancelReveal, { passive: true });
  const notes = root.querySelector('[data-tab-notes]');
  const disabled = tabs.filter(({ key }) => ['events', 'parameters', 'overrides'].includes(key) && !tabAllowed(key, metadata));
  if (notes) {
    notes.textContent = disabled.length ? `Disabled for this application: ${disabled.map(tab => tab.label).join(', ')}` : '';
    notes.hidden = !disabled.length;
  }
  // Horizontal only: a narrow tab strip scrolls to the selected tab without moving the page.
  function keepVisible(button) {
    const list = button.parentElement, box = list.getBoundingClientRect?.(), tab = button.getBoundingClientRect?.();
    if (!box || !tab) return;
    if (tab.left < box.left) list.scrollLeft -= box.left - tab.left;
    else if (tab.right > box.right) list.scrollLeft += tab.right - box.right;
  }
  function render(state) {
    const previous = current;
    current = state.response ? state : null;
    if (!current && !state.busy) cancelReveal();
    for (const { key, label, button, panel } of tabs) {
      const selected = Boolean(state.response && state.activeTab === key);
      if (button.textContent !== label) button.textContent = label;
      button.disabled = !state.response || !tabAllowed(key, metadata);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (['events', 'parameters', 'overrides'].includes(key) && !tabAllowed(key, metadata)) {
        button.setAttribute('aria-describedby', `${key}-unavailable`);
      } else button.removeAttribute('aria-describedby');
      panel.hidden = !selected;
      if (selected && previous?.activeTab !== key) keepVisible(button);
    }
    if (current && previous && previous.activeTab !== state.activeTab) {
      const old = tabs.find(tab => tab.key === previous.activeTab);
      if (old && (old.panel.contains(root.ownerDocument.activeElement)
          || root.ownerDocument.activeElement === old.button)) {
        tabs.find(tab => tab.key === state.activeTab).button.focus({ preventScroll: true });
      }
    }
    if (current) {
      const hash = detailFragment({ tab: state.activeTab,
        ...(state.activeTab === 'events' ? { kind: state.events.query.kind } : {}) }, metadata);
      // Replace only: switching tabs must not put every local inspection in Back history.
      if (window.location.hash !== hash) window.history.replaceState(window.history.state, '',
        window.location.pathname + window.location.search + hash);
    }
  }
  return {
    render,
    follow,
    reveal,
    dispose() {
      for (const tab of tabs) tab.button.removeEventListener('keydown', keyboard);
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('scroll', cancelReveal);
      cancelReveal();
      current = null;
    },
  };
}
