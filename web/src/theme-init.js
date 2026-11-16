// Classic script loaded in <head> before the stylesheet: apply a saved Light/Dark choice
// before the first paint. Without a saved choice the stylesheet follows the system.
// It also marks a browser below the Baseline 2025 floor, so the page can say so.
(function () {
  try {
    var theme = window.localStorage.getItem('sd-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    // Storage unavailable: follow the system preference.
  }
  try {
    // Invoker commands became Baseline in December 2025 (Chrome/Edge 135, Firefox 144, Safari 26.2).
    var button = window.HTMLButtonElement;
    if (!button || !('command' in button.prototype)) {
      document.documentElement.setAttribute('data-browser-unsupported', '');
    }
  } catch (error) {
    // The notice is advisory; the page still starts.
  }
})();
