import { createDisplay } from './display.js';
import { createDetailLoader, detailFields } from './detail.js';

export function mountDetail(root, { api, metadata, executionId }) {
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const content = root.querySelector('[data-execution-detail]');
  const status = root.querySelector('[data-detail-status]');
  const retry = root.querySelector('[data-detail-retry]');
  const correlation = root.querySelector('[data-detail-request-id]');
  const observed = root.querySelector('[data-detail-observed]');
  const elapsed = root.querySelector('[data-active-elapsed]');
  const fields = [...root.querySelectorAll('[data-detail-field]')];
  const clear = () => {
    content.hidden = true;
    elapsed.hidden = true;
    observed.textContent = '';
    for (const field of fields) {
      field.textContent = '—';
      field.removeAttribute('datetime');
      field.removeAttribute('title');
      delete field.dataset.status;
      delete field.dataset.level;
    }
  };
  const loader = createDetailLoader({ api, metadata, executionId, publish(state) {
    content.setAttribute('aria-busy', String(state.phase === 'loading'));
    retry.hidden = state.phase !== 'error';
    retry.disabled = state.phase === 'loading';
    status.textContent = state.phase === 'loading' ? 'Loading execution…'
      : state.phase === 'ready' ? '' : state.error.message;
    correlation.hidden = !state.error?.requestId;
    correlation.textContent = state.error?.requestId ? `Request ID: ${state.error.requestId}` : '';
    if (!state.response) { clear(); return; }
    const values = detailFields(state.response, display);
    const data = state.response.data;
    for (const field of fields) {
      const key = field.dataset.detailField;
      field.textContent = values[key];
      const time = { created: data.created_at, started: data.started_at, ended: data.ended_at }[key];
      if (time) { field.setAttribute('datetime', time); field.setAttribute('title', time); }
      if (key === 'status') field.dataset.status = data.status.name === 'unknown' ? 'unknown' : String(data.status.code);
      if (key === 'warnings' || key === 'errors') field.dataset.level =
        data.event_counts[key] === 0 ? 'quiet' : key === 'warnings' ? 'warning' : 'error';
    }
    elapsed.hidden = data.started_at === null || data.ended_at !== null;
    observed.textContent = `Observed ${display.timestamp(state.response.meta.generated_at)}`;
    content.hidden = false;
  } });
  const load = () => { void loader.load(); };
  retry.addEventListener('click', load);
  load();
  return () => {
    loader.dispose();
    retry.removeEventListener('click', load);
    clear();
  };
}
