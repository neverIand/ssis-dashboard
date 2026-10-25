import 'vite/modulepreload-polyfill';
import './styles.css';
import { mountBootstrap } from './bootstrap.js';
import { mountDetail } from './render-detail.js';
import { mountOverviewScreen } from './overview-screen.js';
import { mountInfoTips, mountThemeChoice } from './ui.js';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  // Presentation only and independent of settings: mounted once, kept across cache restores.
  mountThemeChoice(root);
  let dispose;
  let disposeTips;
  let checkpoint = () => null;
  let retained = null;
  const start = () => {
    dispose?.();
    disposeTips?.();
    disposeTips = mountInfoTips(root);
    const saved = retained;
    retained = null;
    checkpoint = () => null;
    try {
      if (root.dataset.screen === 'execution') {
        dispose = mountBootstrap(root, { ready: (metadata, api, config) => {
          const detail = mountDetail(root, { metadata, api, executionId: config.execution_id,
            appBase: config.app_base, restoreView: saved?.detail });
          checkpoint = () => ({ detail: detail.checkpoint() });
          return detail.dispose;
        } });
      } else if (root.dataset.screen === 'overview') {
        const overview = mountOverviewScreen(root, saved);
        dispose = overview.dispose;
        checkpoint = overview.checkpoint;
      } else throw new TypeError('Unknown screen.');
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
