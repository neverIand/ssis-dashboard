import 'vite/modulepreload-polyfill';
import './styles.css';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  root.querySelector('[data-app-status]').textContent = 'Data not loaded.';
  root.dataset.startup = 'ready';
}
