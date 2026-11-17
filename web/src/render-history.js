import { formatCode } from './display.js';
import { executionHref } from './detail-navigation.js';
import { mountHistoryChart } from './render-history-chart.js';
import { allHistoryStatuses } from './history.js';
import { historyExecutionHref } from './history-navigation.js';
import { mountSectionTable } from './section-table.js';
import { positionPopover } from './ui.js';

export function mountHistory(root, { metadata, actions, navigation, executionId, restoreView = null, showIdentity = false,
  notLoaded = 'No history loaded.', rememberChart = false }) {
  const view = mountSectionTable(root, { metadata, actions, restoreView }, {
    resource: 'history',
    columns: 7,
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
  const chart = mountHistoryChart(root, { metadata, restoreView: restoreView?.chart, remember: rememberChart,
    openExecution: id => { const href = rows.get(id)?.link.getAttribute('href'); if (href) document.defaultView.location.assign(href); } });
  let appliedStatus = null, commitOnClose = true, presetPointer = false;
  const statusesOpen = () => statusOptions.matches(':popover-open');
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
    input.autofocus = choices.size === 0;
    label.append(input, element('span', formatCode(item)));
    get('choices').append(label);
    choices.set(input.value, input);
    controls[`status-${input.value}`] = input;
  }
  function time(node, value, created = null, exactTitle = true) {
    const key = `${value ?? ''}/${created ?? ''}`;
    if (node.getAttribute('data-time') === key) return;
    node.setAttribute('data-time', key);
    if (value === null) node.textContent = '—';
    else {
      const full = display.timestamp(value), sameDay = created !== null && full.slice(0, 10) === display.timestamp(created).slice(0, 10);
      const stamp = element('time', sameDay ? full.slice(11) : full);
      stamp.setAttribute('datetime', value);
      if (exactTitle) stamp.title = value;
      node.replaceChildren(stamp);
    }
  }
  function paintRow(item, row) {
    const id = item.execution_id;
    if (!row) {
      const node = element('tr');
      node.dataset.historyId = id;
      const cells = Array.from({ length: 7 }, () => element('td'));
      const link = element('a', id), badge = element('span', undefined, 'status-badge');
      link.href = navigation.historySelection ? historyExecutionHref(id, navigation.historySelection, navigation)
        : executionHref(id, navigation.selection, navigation);
      node.dataset.current = String(id === executionId);
      if (id === executionId) link.setAttribute('aria-current', 'page');
      cells[0].append(link);
      if (id === executionId) cells[0].append(element('span', ' · current', 'current-execution'));
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
      const deviation = element('span', undefined, 'deviation');
      cells[5].append(estimate, end, samples, deviation);
      cells[6].append(badge);
      node.append(...cells);
      row = { node, link, badge, times, duration, elapsed, estimate, end, samples, deviation };
      rows.set(id, row);
    }
    text(row.badge, formatCode(item.status));
    row.badge.dataset.status = String(item.status.code);
    for (const key of ['created_at', 'started_at', 'ended_at']) time(row.times[key], item[key],
      key === 'created_at' ? null : item.created_at);
    text(row.duration, display.duration(item.duration_seconds));
    row.elapsed.hidden = item.ended_at !== null || item.elapsed_seconds === null;
    text(row.elapsed, row.elapsed.hidden ? '' : ` · elapsed ${display.duration(item.elapsed_seconds)}`);
    row.duration.parentElement.title = row.elapsed.hidden ? '' : 'Elapsed at last update';
    // Running rows need the expected end; ended rows need how far the actual run was from the estimate.
    const ended = item.ended_at !== null;
    const change = ended && item.estimate !== null && item.duration_seconds !== null && item.estimate.duration_seconds > 0
      ? (item.duration_seconds - item.estimate.duration_seconds) / item.estimate.duration_seconds * 100 : null;
    text(row.estimate, item.estimate === null ? 'Unavailable'
      : `${display.duration(item.estimate.duration_seconds)}${ended ? '' : ' · ends '}`);
    row.samples.hidden = item.estimate === null;
    row.end.hidden = item.estimate === null || ended;
    if (ended) { row.end.replaceChildren(); row.end.removeAttribute('data-time'); }
    else time(row.end, item.estimate?.ended_at ?? null, item.created_at, false);
    text(row.samples, item.estimate === null ? '' : ` · avg of ${display.count(item.estimate.sample_count)}`);
    const rounded = change === null ? null : Math.round(change);
    text(row.deviation, rounded === null ? '' : ` · ${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}%`);
    row.deviation.hidden = rounded === null;
    // Only a much slower run is flagged; a short failed run is not "better", so nothing is coloured for faster runs.
    row.deviation.dataset.level = rounded !== null && rounded >= 50 ? 'warning' : 'quiet';
    const estimateCell = row.estimate.parentElement;
    const estimatedEnd = item.estimate && display.timestamp(item.estimate.ended_at);
    if (estimatedEnd && (ended || row.end.textContent !== estimatedEnd)) {
      estimateCell.setAttribute('title', `Estimated end ${estimatedEnd}`);
    } else estimateCell.removeAttribute('title');
    return row;
  }
  const restoreChoices = () => {
    for (const [code, input] of choices) input.checked = appliedStatus?.split(',').includes(code) ?? false;
  };
  function closeStatuses({ commit = true, focus = false } = {}) {
    if (!statusesOpen()) return;
    commitOnClose = commit;
    statusOptions.hidePopover();
    if (focus) custom.focus({ preventScroll: true });
  }
  function positionStatuses() {
    if (statusesOpen()) positionPopover(statusOptions, custom);
  }
  listen(statusOptions, 'beforetoggle', event => {
    if (event.newState === 'open') {
      if (view.busy || panel.hidden) { event.preventDefault(); return; }
      presetPointer = false;
      return;
    }
    const commit = commitOnClose && !presetPointer;
    commitOnClose = true; presetPointer = false;
    const status = [...choices].filter(([, input]) => input.checked).map(([code]) => code).join(',');
    if (!commit || view.busy) restoreChoices();
    else if (!status) {
      restoreChoices();
      notice.textContent = 'Choose at least one history status.';
    } else if (status !== appliedStatus) actions.order({ status });
  });
  listen(statusOptions, 'toggle', positionStatuses);
  listen(statusOptions, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeStatuses({ commit: false, focus: true });
    }
  });
  listen(document, 'pointerdown', (event) => {
    presetPointer = statusesOpen() && [...presets.values()].some(({ button }) => button.contains(event.target));
  });
  listen(document, 'focusin', (event) => {
    if (!presetPointer && !statusOptions.contains(event.target) && !custom.contains(event.target)) closeStatuses();
  });
  listen(document.defaultView, 'resize', positionStatuses);
  listen(document, 'scroll', positionStatuses);
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
    notLoaded,
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
    pageInfo: (page, state) => {
      const identities = new Set(page.data.map(item => JSON.stringify([item.folder_name, item.project_name, item.package_name]))).size;
      return `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} executions on this page`
        + (identities > 1 ? ` · ${display.count(identities)} packages` : '');
    },
    afterStatus: positionStatuses,
    restore(returning) {
      if (returning.statusOptionsOpen === true && !panel.hidden) {
        const first = choices.values().next().value;
        first.autofocus = false;
        statusOptions.showPopover(); positionStatuses();
        first.autofocus = true;
      }
    },
    checkpoint: () => ({
      chart: chart.checkpoint(),
      statusOptionsOpen: statusesOpen(),
      draft: [...choices].filter(([, input]) => input.checked).map(([code]) => code)
    }),
    beforeDispose: () => { closeStatuses({ commit: false }); chart.dispose(); },
    clear() {
      closeStatuses({ commit: false });
      get('choices').replaceChildren();
      get('presets').replaceChildren();
    }
  });
}
