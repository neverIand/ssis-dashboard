import { ApiError } from './api.js';
import { SelectionError, validateSelection } from './selection.js';
import { calendarBound, localCandidates, nextDate, presetRange, projectTime } from './time-range.js';

export function mountRangeEditor(form, { metadata, api, listen, onChoose }) {
  const get = selector => form.querySelector(selector);
  const mode = get('#creation-window'), include = get('#include-time');
  const notice = get('[data-time-notice]'), use = get('[data-use-range]');
  const fields = Object.fromEntries(['from', 'to'].map(key => [key, {
    date: get(`#${key}-date`), time: get(`#${key}-time`), exact: get(`#${key}`),
    occurrence: get(`#${key}-occurrence`), occurrenceLabel: get(`[data-occurrence-label="${key}"]`),
  }]));
  let original = null, dirty = new Set(), active = null, generation = 0;
  const exact = new Set();
  const zone = metadata.display_timezone;
  mode.querySelector('option').textContent = `Default window (${metadata.limits.default_range_hours} h)`;
  for (const [value, hours] of [['24h', 24], ['7d', 168], ['30d', 720]]) {
    mode.querySelector(`option[value="${value}"]`).disabled = hours > metadata.limits.max_range_hours;
  }
  function cancel() {
    generation += 1;
    if (active) { clearTimeout(active.timer); active.controller.abort(); }
    active = null;
    use.disabled = false;
  }
  function show() {
    get('[data-custom-window]').hidden = mode.value !== 'custom';
    get('[data-time-fields]').hidden = !include.checked;
    get('[data-time-help]').textContent = include.checked
      ? 'Start included; end excluded. A blank date uses the server default.'
      : 'Start and end dates included. A blank date uses the server default.';
    for (const [key, field] of Object.entries(fields)) {
      field.time.disabled = !field.date.value;
      field.occurrenceLabel.hidden = true;
      if (!dirty.has(key) || exact.has(key)) continue;
      field.exact.value = '';
      if (!field.date.value) continue;
      try {
        const candidates = localCandidates(key === 'to' && !include.checked ? nextDate(field.date.value) : field.date.value,
          include.checked ? field.time.value : '00:00:00', zone);
        field.occurrenceLabel.hidden = candidates.length < 2;
        if (candidates.length === 2) {
          for (let index = 0; index < 2; index += 1) {
            field.occurrence.querySelector(`option[value="${index}"]`).textContent =
              `${index ? 'Second' : 'First'} occurrence (${candidates[index].offset})`;
          }
        }
        field.exact.value = calendarBound(field.date.value, field.time.value, zone,
          { end: key === 'to', includeTime: include.checked, occurrence: field.occurrence.value }) ?? '';
      } catch { /* Incomplete dates/times are validated when the user uses the range. */ }
    }
  }
  listen(mode, 'change', () => { cancel(); notice.textContent = ''; show(); });
  listen(include, 'change', () => {
    exact.clear(); dirty = new Set(['from', 'to']);
    for (const field of Object.values(fields)) field.occurrence.value = '';
    notice.textContent = ''; show();
  });
  for (const [key, field] of Object.entries(fields)) {
    for (const control of [field.date, field.time]) listen(control, 'input', () => {
      exact.delete(key); dirty.add(key); field.occurrence.value = ''; notice.textContent = ''; show();
    });
    listen(field.occurrence, 'change', show);
    listen(field.exact, 'input', () => {
      exact.add(key); dirty.add(key); notice.textContent = '';
      try {
        const projected = field.exact.value ? projectTime(field.exact.value, zone) : { date: '', time: '00:00:00' };
        field.date.value = projected.date; field.time.value = projected.time;
      } catch { /* Exact text is validated on Use range. */ }
      show();
    });
  }
  listen(use, 'click', async () => {
    if (active || !original) return;
    notice.textContent = '';
    let range;
    const current = ++generation;
    try {
      if (mode.value === 'default') range = { from: null, to: null };
      else if (mode.value === 'custom') {
        range = {};
        for (const [key, field] of Object.entries(fields)) {
          if (exact.has(key)) range[key] = field.exact.value || null;
          else if (!dirty.has(key)) range[key] = original[key];
          else {
            if (field.date.validity?.badInput || (include.checked && field.time.validity?.badInput)) {
              throw new SelectionError('Complete the date and time.');
            }
            range[key] = calendarBound(field.date.value, field.time.value, zone,
              { end: key === 'to', includeTime: include.checked, occurrence: field.occurrence.value });
          }
        }
        if (!range.from && !range.to) throw new SelectionError('Choose at least one date or use Default window.');
      } else {
        const controller = new AbortController();
        active = { controller, timer: setTimeout(() => controller.abort(), 10000) };
        use.disabled = true;
        notice.textContent = 'Resolving range…';
        const response = await api.get('meta', { signal: controller.signal });
        if (current !== generation) return;
        if (controller.signal.aborted) throw new ApiError('timeout');
        range = presetRange(mode.value, response.meta.generated_at, zone);
      }
      validateSelection({ ...original, ...range }, metadata);
      onChoose(range);
    } catch (error) {
      if (current !== generation) return;
      notice.textContent = active?.controller.signal.aborted ? 'The request timed out. Try again.'
        : error instanceof SelectionError || error instanceof ApiError ? error.message : 'The range could not be resolved. Try again.';
    } finally { if (current === generation) cancel(); }
  });
  return {
    open(selection) {
      cancel(); original = selection; dirty = new Set(); exact.clear();
      const custom = selection.from !== null || selection.to !== null;
      mode.value = custom ? 'custom' : 'default';
      include.checked = custom;
      get('.exact-times').open = false;
      for (const [key, field] of Object.entries(fields)) {
        const projected = selection[key] ? projectTime(selection[key], zone) : { date: '', time: '00:00:00' };
        field.date.value = projected.date; field.time.value = projected.time;
        field.exact.value = selection[key] ?? ''; field.occurrence.value = '';
      }
      notice.textContent = ''; show();
    },
    cancel,
  };
}
