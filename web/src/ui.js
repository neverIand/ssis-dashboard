// Presentation only: these helpers own no data, requests or timers.
const paths = {
  pause: 'M8 5v14 M16 5v14',
  play: 'M8 5l11 7-11 7Z',
};

export function pollingButton(button, paused) {
  const name = paused ? 'play' : 'pause', label = paused ? 'Resume auto refresh' : 'Pause auto refresh';
  button.setAttribute('aria-label', label);
  button.title = label;
  if (button.dataset.icon === name) return;
  const document = button.ownerDocument;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 18, height: 18,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false })) svg.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]); svg.append(path); button.replaceChildren(svg); button.dataset.icon = name;
}

export function inlineStatus(node, text, detail = '') {
  node.textContent = text;
  node.title = [text, detail].filter(Boolean).join(' · ');
}

export function mountInfoTips(root) {
  const document = root.ownerDocument, window = document.defaultView, removers = [];
  const listen = (node, event, action) => {
    node.addEventListener(event, action); removers.push(() => node.removeEventListener(event, action));
  };
  const tips = [...root.querySelectorAll('.info-trigger')].map(button => {
    const tip = document.getElementById(button.getAttribute('aria-describedby'));
    const container = button.parentElement;
    let hovered = false;
    const hide = () => { tip.hidden = true; };
    const show = () => {
      tip.hidden = false;
      const anchor = button.getBoundingClientRect(), box = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
      tip.style.top = `${anchor.bottom + box.height + 8 <= window.innerHeight
        ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)}px`;
    };
    hide();
    listen(container, 'pointerenter', () => { hovered = true; show(); });
    listen(container, 'pointerleave', () => { hovered = false; if (document.activeElement !== button) hide(); });
    listen(button, 'focus', show);
    listen(button, 'blur', () => { if (!hovered) hide(); });
    return { hide };
  });
  const hideAll = () => tips.forEach(tip => tip.hide());
  listen(document, 'keydown', event => { if (event.key === 'Escape') hideAll(); });
  listen(window, 'resize', hideAll);
  listen(document, 'scroll', hideAll);
  return () => { hideAll(); removers.forEach(remove => remove()); };
}
