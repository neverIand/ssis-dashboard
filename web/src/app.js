// The composition root without its imports, so tests can drive it: one screen per document, chosen by
// data-screen; a document the browser retains on Back hands its checkpoint to the screen it restarts.
export function startApp(root, { window, screens, mountTips }) {
  let dispose;
  let disposeTips;
  let checkpoint = () => null;
  let retained = null;
  const start = () => {
    dispose?.();
    disposeTips?.();
    disposeTips = mountTips(root);
    const saved = retained;
    retained = null;
    checkpoint = () => null;
    try {
      if (!Object.hasOwn(screens, root.dataset.screen)) throw new TypeError('Unknown screen.');
      const screen = screens[root.dataset.screen](root, saved);
      dispose = screen.dispose;
      checkpoint = screen.checkpoint;
    } catch {
      root.dataset.startup = 'error';
      root.querySelector('[data-app-status]').textContent =
        'The dashboard could not start. Reload the page or use the legacy dashboard.';
      root.querySelector('[data-app-status]').hidden = false;
    }
  };
  window.addEventListener('pagehide', (event) => {
    retained = event.persisted ? checkpoint() : null;
    dispose?.();
    disposeTips?.();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
  start();
}
