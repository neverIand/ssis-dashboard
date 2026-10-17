import 'vite/modulepreload-polyfill';
import './styles.css';
import { mountBootstrap } from './bootstrap.js';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  let dispose;
  const start = () => {
    dispose?.();
    try {
      dispose = mountBootstrap(root);
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
