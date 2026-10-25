// Classic script loaded in <head> before the stylesheet: apply a saved Light/Dark choice
// before the first paint. Without a saved choice the stylesheet follows the system.
(function () {
  try {
    var theme = window.localStorage.getItem('sd-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    // Storage unavailable: follow the system preference.
  }
})();
