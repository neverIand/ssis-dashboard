// Scheduling owns one timer; data requests belong to the mounted screen's owner.
export function createRefreshLoop({ refresh, publish, intervalMs = 30000, maxIntervalMs = 300000,
  paused = false, visible = true }) {
  let timer = null, nextAt = null, generation = 0;
  let busy = false, eligible = false, blocked = false, disposed = false;
  let failures = 0, started = null, lastCompleted = null, delayMs = intervalMs;

  function snapshot() {
    const mode = disposed || !eligible ? 'idle' : paused ? 'paused' : !visible ? 'hidden'
      : busy ? 'updating' : blocked ? 'blocked' : nextAt !== null ? 'scheduled' : 'idle';
    return { mode, paused, visible, failures, delayMs, nextAt };
  }

  function clear() {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = nextAt = null;
  }

  const runnable = () => !disposed && eligible && !paused && visible && !blocked;
  const notify = () => publish(snapshot());

  function schedule(at) {
    clear();
    const current = generation;
    nextAt = at;
    timer = setTimeout(() => {
      if (disposed || current !== generation) return;
      timer = nextAt = null;
      if (runnable() && !busy) void refresh();
    }, Math.max(0, at - Date.now()));
  }

  return {
    snapshot,
    update({ busy: nextBusy, eligible: nextEligible, failed = false, retryable = true }) {
      if (disposed) return snapshot();
      const finished = busy && !nextBusy;
      if (nextBusy && (!busy || started === null)) started = Date.now();
      busy = nextBusy;
      eligible = nextEligible;
      if (busy || !runnable()) clear();
      if (finished) {
        lastCompleted = Date.now();
        const elapsed = started === null ? 0 : Math.max(0, lastCompleted - started);
        started = null;
        failures = failed ? failures + 1 : 0;
        blocked = failed && !retryable;
        delayMs = Math.min(maxIntervalMs, Math.max(intervalMs, Math.ceil(elapsed * 5),
          failed ? intervalMs * 2 ** Math.min(failures - 1, 10) : 0));
        if (runnable()) schedule(lastCompleted + delayMs);
      } else if (!busy && runnable() && timer === null) schedule(Date.now() + delayMs);
      return snapshot();
    },
    reset() {
      clear();
      failures = 0;
      blocked = false;
      started = lastCompleted = null;
      delayMs = intervalMs;
    },
    setPaused(value) {
      if (disposed || paused === value) return;
      paused = value;
      clear();
      if (!paused) {
        blocked = false;
        failures = 0;
        if (runnable() && !busy) schedule(Date.now());
      }
      notify();
    },
    togglePaused() { this.setPaused(!paused); },
    setVisible(value) {
      if (disposed || visible === value) return;
      visible = value;
      clear();
      if (runnable() && !busy) {
        schedule(lastCompleted === null ? Date.now() : Math.max(Date.now(), lastCompleted + delayMs));
      }
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
