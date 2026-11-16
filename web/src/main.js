import './styles.css';
import { startApp } from './app.js';
import { mountDetailScreen } from './detail-screen.js';
import { mountOverviewScreen } from './overview-screen.js';
import { mountHistoryScreen } from './history-screen.js';
import { mountInfoTips, mountSkipLink, mountThemeChoice } from './ui.js';

const root = document.querySelector('[data-dashboard-app]');
if (root) {
  // Presentation only and independent of settings: mounted once, kept across cache restores.
  mountThemeChoice(root);
  mountSkipLink(root);
  startApp(root, { window, mountTips: mountInfoTips,
    screens: { execution: mountDetailScreen, overview: mountOverviewScreen, history: mountHistoryScreen } });
}
