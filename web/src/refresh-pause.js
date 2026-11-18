export function readRefreshPause(window) {
  return window.history.state?.autoRefreshPaused === true;
}

export function refreshPauseState(paused, state) {
  return { ...state, autoRefreshPaused: paused };
}

export function saveRefreshPause(window, paused) {
  window.history.replaceState(refreshPauseState(paused, window.history.state), '', window.location.href);
}
