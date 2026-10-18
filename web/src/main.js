import 'vite/modulepreload-polyfill';
import './styles.css';
import { mountBootstrap } from './bootstrap.js';
import { mountFilters } from './filters.js';
import { mountOverview } from './render-overview.js';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  let dispose;
  let checkpoint = () => null;
  let retained = null;
  const start = () => {
    dispose?.();
    const saved = retained;
    retained = null;
    checkpoint = () => null;
    try {
      dispose = mountBootstrap(root, { ready: (metadata, api, config) => {
        const overview = mountOverview(root, { metadata, api, executionBase: config.execution_base,
          retainedPaths: saved?.paths, restoreView: saved?.view });
        if (saved) { saved.paths.length = 0; saved.view = null; }
        checkpoint = overview.checkpoint;
        const filters = mountFilters(root, { metadata, api, appBase: config.app_base,
          onApplied: (selection, options) => { void overview.apply(selection, options); } });
        return () => { filters(); overview.dispose(); };
      } });
    } catch {
      root.dataset.startup = 'error';
      root.querySelector('[data-app-status]').textContent =
        'The dashboard could not start. Reload the page or use the legacy dashboard.';
    }
  };
  window.addEventListener('pagehide', (event) => {
    retained = event.persisted ? checkpoint() : null;
    dispose?.();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
  start();
}
