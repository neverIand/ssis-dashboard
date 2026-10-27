import { formatCode } from './display.js';
import { executionHref } from './detail-navigation.js';
import { mountHistoryChart } from './render-history-chart.js';
import { allHistoryStatuses } from './history.js';
import { historyExecutionHref } from './history-navigation.js';
import { mountSectionTable } from './section-table.js';

export function mountHistory(root, { metadata, actions, navigation, executionId, restoreView = null, showIdentity = false }) {
  const view = mountSectionTable(root, { metadata, actions, restoreView }, {
    resource: 'history',
    columns: 6,
    identity: 'execution_id',
    focusMode: 'removed',
    controlNames: [
      'toggle',
      'retry',
      'previous',
      'next',
      'latest',
      'limit',
      'apply',
      'custom',
      'close',
      'scroll'
    ],
    sorts: [{ key: 'execution_id', label: 'Execution ID', header: true, initialDirection: 'desc' }],
    disclosures: [{ focus: 'executionFocus', summary: 'link' }],
    focusFallback: ['executionFocus']
  });
  const { document, get, controls, rows, panel, notice, display, element, text, listen } = view;
  const { apply, custom, close } = controls;
  const form = get('filters'), presets = new Map(), choices = new Map(), statusOptions = get('status-options');
  const chart = mountHistoryChart(root, { metadata, restoreView: restoreView?.chart });
  let appliedStatus = null;
  statusOptions.hidden = restoreView?.statusOptionsOpen !== true;
  for (const [key, label, status] of [
    ['all', 'All', allHistoryStatuses(metadata)],
    ['succeeded', 'Succeeded', '7'],
    ['failed', 'Failed', '4'],
    ['running', 'Running', '2']
  ]) {
    if (status.split(',').some((code) => !metadata.execution_statuses.some((item) => String(item.code) === code))) continue;
    const button = element('button', label);
    button.type = 'button';
    button.dataset.historyPreset = key;
    get('presets').append(button);
    presets.set(key, { button, status });
    controls[`preset-${key}`] = button;
  }
  for (const item of metadata.execution_statuses) {
    const label = element('label', undefined, 'check-label'), input = element('input');
    input.type = 'checkbox';
    input.value = String(item.code);
    label.append(input, element('span', formatCode(item)));
    get('choices').append(label);
    choices.set(input.value, input);
    controls[`status-${input.value}`] = input;
  }
  function time(node, value, created = null) {
    const key = `${value ?? ''}/${created ?? ''}`;
    if (node.getAttribute('data-time') === key) return;
    node.setAttribute('data-time', key);
    if (value === null) node.textContent = '—';
    else {
      const full = display.timestamp(value), sameDay = created !== null && full.slice(0, 10) === display.timestamp(created).slice(0, 10);
      const stamp = element('time', sameDay ? full.slice(11) : full);
      stamp.setAttribute('datetime', value);
      stamp.title = `${full} · ${value}`;
      node.replaceChildren(stamp);
    }
  }
  function paintRow(item, row) {
    const id = item.execution_id;
    if (!row) {
      const node = element('tr');
      node.dataset.historyId = id;
      const cells = Array.from({ length: 6 }, () => element('td'));
      const link = element('a', id), badge = element('span', undefined, 'status-badge');
      link.href = navigation.historySelection ? historyExecutionHref(id, navigation.historySelection, navigation)
        : executionHref(id, navigation.selection, navigation);
      node.dataset.current = String(id === executionId);
      if (id === executionId) link.setAttribute('aria-current', 'page');
      cells[0].append(link, document.createTextNode(' '), badge);
      if (id === executionId) cells[0].append(element('span', 'current', 'current-execution'));
      if (showIdentity) {
        const identity = element('span', `${item.folder_name} / ${item.project_name} / ${item.package_name}`, 'history-identity');
        identity.title = identity.textContent;
        cells[0].append(identity);
      }
      const times = {};
      for (const key of ['created_at', 'started_at', 'ended_at']) {
        times[key] = cells[{ created_at: 1, started_at: 2, ended_at: 3 }[key]];
      }
      const duration = element('span'), elapsed = element('span');
      cells[4].append(duration, elapsed);
      const estimate = element('span'), end = element('span'), samples = element('span');
      cells[5].append(estimate, end, samples);
      node.append(...cells);
      row = { node, link, badge, times, duration, elapsed, estimate, end, samples };
      rows.set(id, row);
    }
    text(row.badge, formatCode(item.status));
    row.badge.dataset.status = String(item.status.code);
    for (const key of ['created_at', 'started_at', 'ended_at']) time(row.times[key], item[key],
      key === 'created_at' ? null : item.created_at);
    text(row.duration, display.duration(item.duration_seconds));
    row.elapsed.hidden = item.ended_at !== null || item.elapsed_seconds === null;
    text(row.elapsed, row.elapsed.hidden ? '' : ` · elapsed ${display.duration(item.elapsed_seconds)}`);
    row.duration.parentElement.title = row.elapsed.hidden ? '' : `Active elapsed (observed): ${display.duration(item.elapsed_seconds)}`;
    text(row.estimate, item.estimate === null ? 'Unavailable' : `${display.duration(item.estimate.duration_seconds)} · ends `);
    row.end.hidden = row.samples.hidden = item.estimate === null;
    time(row.end, item.estimate?.ended_at ?? null, item.created_at);
    text(row.samples, item.estimate === null ? '' : ` (${display.count(item.estimate.sample_count)})`);
    row.estimate.parentElement.title = item.estimate === null ? 'Estimate unavailable'
      : `Estimated duration: ${display.duration(item.estimate.duration_seconds)}`
        + ` · Estimated end: ${display.timestamp(item.estimate.ended_at)}`
        + ` · Mean of ${display.count(item.estimate.sample_count)} prior successful runs`;
    return row;
  }
  const restoreChoices = () => {
    for (const [code, input] of choices) input.checked = appliedStatus?.split(',').includes(code) ?? false;
  };
  function closeStatuses({ commit = true, focus = false } = {}) {
    if (statusOptions.hidden) return;
    statusOptions.hidden = true;
    custom.setAttribute('aria-expanded', 'false');
    const status = [...choices].filter(([, input]) => input.checked).map(([code]) => code).join(',');
    if (!commit || view.busy) restoreChoices();
    else if (!status) {
      restoreChoices();
      notice.textContent = 'Choose at least one history status.';
    } else if (status !== appliedStatus) actions.order({ status });
    if (focus) custom.focus({ preventScroll: true });
  }
  function positionStatuses() {
    if (statusOptions.hidden) return;
    const box = panel.getBoundingClientRect(), anchor = custom.getBoundingClientRect();
    statusOptions.style.top = `${anchor.bottom - box.top + 6}px`;
    statusOptions.style.left = `${Math.max(0, Math.min(anchor.left - box.left, Math.max(0, box.width - 400)))}px`;
  }
  listen(custom, 'click', () => {
    if (view.busy || panel.hidden) return;
    if (!statusOptions.hidden) {
      closeStatuses({ focus: true });
      return;
    }
    statusOptions.hidden = false;
    custom.setAttribute('aria-expanded', 'true');
    positionStatuses();
    choices.values().next().value?.focus({ preventScroll: true });
  });
  listen(close, 'click', () => closeStatuses({ focus: true }));
  listen(statusOptions, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeStatuses({ commit: false, focus: true });
    }
  });
  listen(document, 'pointerdown', (event) => {
    if (statusOptions.hidden || statusOptions.contains(event.target) || custom.contains(event.target)) return;
    if ([...presets.values()].some(({ button }) => button.contains(event.target))) event.preventDefault();
    else closeStatuses();
  });
  for (const eventName of ['click', 'focusin']) listen(document, eventName, (event) => {
    if (!statusOptions.hidden && !statusOptions.contains(event.target) && !custom.contains(event.target)) closeStatuses();
  });
  listen(document.defaultView, 'resize', positionStatuses);
  for (const { button, status } of presets.values()) listen(button, 'click', () => {
    if (view.busy || panel.hidden) return;
    closeStatuses({ commit: false });
    button.focus({ preventScroll: true });
    for (const [code, input] of choices) input.checked = status.split(',').includes(code);
    notice.textContent = '';
    if (status !== appliedStatus) actions.order({ status });
  });
  listen(form, 'submit', (event) => {
    event.preventDefault();
    closeStatuses({ focus: true });
  });
  return view.mount({
    paintRow,
    loading: 'Loading package history…',
    notLoaded: 'No history loaded.',
    previousPage: 'Previous history page shown.',
    disabled: [
      apply,
      custom,
      close,
      ...choices.values(),
      ...[...presets.values()].map((item) => item.button)
    ],
    busyControls: [
      apply,
      custom,
      ...[...presets.values()].map((item) => item.button)
    ],
    emptyMessage: (page, number) => number > 1 ? 'No executions remain on this page. Use Previous or First page.'
      : 'No executions match this package and status scope.',
    hide: () => closeStatuses({ commit: false }),
    filters(state, returning) {
      if (appliedStatus !== state.query.status) {
        const chosen = appliedStatus === null && returning?.draft ? returning.draft : state.query.status.split(',');
        for (const [code, input] of choices) input.checked = chosen.includes(code);
        appliedStatus = state.query.status;
      }
      for (const { button, status } of presets.values()) button.setAttribute('aria-pressed', String(status === state.query.status));
      custom.setAttribute('aria-expanded', String(!statusOptions.hidden));
      custom.setAttribute('aria-pressed', String(![...presets.values()].some((item) => item.status === state.query.status)));
      custom.title = state.query.status.split(',').map(code => formatCode(
        metadata.execution_statuses.find(item => String(item.code) === code) ?? { code: Number(code), name: 'unknown' }
      )).join(', ');
    },
    beforePaint: (page, state, busy) => chart.render({
      page,
      pageNumber: state.pageNumber,
      busy,
      visible: !panel.hidden,
      stale: state.stale
    }),
    pageInfo: (page, state) => `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} executions on this page`,
    afterStatus: positionStatuses,
    restore(returning) {
      statusOptions.hidden = returning.statusOptionsOpen !== true;
      custom.setAttribute('aria-expanded', String(!statusOptions.hidden));
      positionStatuses();
    },
    checkpoint: () => ({
      chart: chart.checkpoint(),
      statusOptionsOpen: !statusOptions.hidden,
      draft: [...choices].filter(([, input]) => input.checked).map(([code]) => code)
    }),
    beforeDispose: () => chart.dispose(),
    clear() {
      get('choices').replaceChildren();
      get('presets').replaceChildren();
      statusOptions.hidden = true;
      custom.setAttribute('aria-expanded', 'false');
    }
  });
}
