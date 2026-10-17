import 'vite/modulepreload-polyfill';
import './styles.css';
import { mountBootstrap } from './bootstrap.js';
import { mountFilters } from './filters.js';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  let dispose;
  const start = () => {
    dispose?.();
    try {
      dispose = mountBootstrap(root, { ready: (metadata, api, config) =>
        mountFilters(root, { metadata, api, appBase: config.app_base }) });
    } catch {
      root.dataset.startup = 'error';
      root.querySelector('[data-app-status]').textContent =
        'The dashboard could not start. Reload the page or use the legacy dashboard.';
    }
  };
  window.addEventListener('pagehide', () => dispose?.());
  window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
  start();
}
