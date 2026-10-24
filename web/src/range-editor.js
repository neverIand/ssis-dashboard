import { SelectionError, validateSelection } from './selection.js';
import { calendarBound, localCandidates, nextDate, projectTime } from './time-range.js';

export function mountRangeEditor(form, { metadata, listen, onChoose }) {
  const get = selector => form.querySelector(selector);
  const presets = [...form.querySelectorAll('[data-created-preset]')], include = get('#include-time');
  const notice = get('[data-time-notice]'), use = get('[data-use-range]');
  const fields = Object.fromEntries(['from', 'to'].map(key => [key, {
    date: get(`#${key}-date`), time: get(`#${key}-time`), exact: get(`#${key}`),
    occurrence: get(`#${key}-occurrence`), occurrenceLabel: get(`[data-occurrence-label="${key}"]`),
  }]));
  let original = null, dirty = new Set(), mode = 'default';
  const exact = new Set();
  const zone = metadata.display_timezone;
  for (const button of presets) {
    const value = button.dataset.createdPreset;
    if (value === 'default') button.textContent = `Default window (${metadata.limits.default_range_hours} h)`;
    button.disabled = ({ '24h': 24, '7d': 168, '30d': 720 }[value] ?? 0) > metadata.limits.max_range_hours;
    listen(button, 'click', () => {
      mode = value; notice.textContent = '';
      if (mode === 'custom') { show(); fields.from.date.focus(); }
      else choose({ created: mode === 'default' ? null : mode, from: null, to: null });
    });
  }
  function show() {
    get('[data-custom-window]').hidden = mode !== 'custom';
    use.hidden = mode !== 'custom';
    for (const button of presets) button.setAttribute('aria-pressed', String(button.dataset.createdPreset === mode));
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
  function choose(range) {
    validateSelection({ ...original, ...range }, metadata);
    onChoose(range);
  }
  listen(use, 'click', () => {
    if (!original || mode !== 'custom') return;
    notice.textContent = '';
    try {
      const range = { created: null };
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
      choose(range);
    } catch (error) {
      notice.textContent = error instanceof SelectionError ? error.message : 'The range could not be resolved. Try again.';
    }
  });
  return {
    open(selection, effectiveWindow = null) {
      original = { ...selection, from: selection.from ?? effectiveWindow?.from ?? null,
        to: selection.to ?? effectiveWindow?.to ?? null };
      dirty = new Set(); exact.clear();
      const custom = selection.from !== null || selection.to !== null;
      mode = selection.created ?? (custom ? 'custom' : 'default');
      include.checked = original.from !== null || original.to !== null;
      get('.exact-times').open = false;
      for (const [key, field] of Object.entries(fields)) {
        const projected = original[key] ? projectTime(original[key], zone) : { date: '', time: '00:00:00' };
        field.date.value = projected.date; field.time.value = projected.time;
        field.exact.value = original[key] ?? ''; field.occurrence.value = '';
      }
      notice.textContent = ''; show();
    },
    cancel: () => { original = null; },
  };
}
