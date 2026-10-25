import { formatCode, formatId } from './display.js';
import { mountSectionTable } from './section-table.js';

export function mountObservationTable(root, { metadata, actions, restoreView = null, resource = 'executables' }) {
  const child = resource === 'children', singular = child ? 'package call' : 'executable';
  const idKey = child ? 'observation_id' : 'statistics_id';
  const columns = child ? { count: 5, name: 0, started_at: 1, ended_at: 2, duration: 3, state: 4 }
    : { count: 6, name: 1, started_at: 2, ended_at: 3, duration: 4, state: 5 };
  const view = mountSectionTable(root, { metadata, actions, restoreView }, {
    resource,
    columns: columns.count,
    identity: idKey,
    pagingBusy: true,
    focusMode: 'moved',
    scrollControl: 'region',
    controlNames: ['toggle', 'retry', 'sort', 'limit', 'previous', 'next', 'latest', 'region'],
    disclosures: [{ saved: 'openPaths', field: 'paths', focus: 'focusId', summary: 'summary' }],
    sorts: [{ key: 'started_at', label: 'Started', header: true }, {
      key: child ? 'observation_id' : 'statistics_id',
      label: child ? 'Observation ID' : 'Statistics ID',
      header: !child
    }]
  });
  const { rows, display, element, text } = view;
  const literal = (value) => value === null ? '—' : value === '' ? '(empty)' : value;
  function paintRow(item, record, executionStart) {
    if (!record) {
      const row = element('tr');
      row.dataset[child ? 'observationId' : 'statisticsId'] = item[idKey];
      const cells = Array.from({ length: columns.count }, (_, i) => element('td', undefined,
        i === columns.started_at || i === columns.ended_at ? 'time-cell'
          : i === columns.duration ? 'number-cell' : !child && i === 0 ? 'id-cell' : ''));
      const name = element('span', undefined, child ? 'package-call-name' : '');
      const packageName = element('span', undefined, 'cell-detail');
      const id = child ? element('dd') : null;
      const source = element('dd'), sourceType = element('dd'), callPath = element('span', undefined, 'cell-detail call-path');
      cells[columns.name].className = child ? 'observation-name package-call' : 'observation-name';
      cells[columns.name].append(name);
      const paths = element('details'), summary = element('summary', child ? 'Details' : 'Paths');
      const pathFields = element('dl', undefined, 'observation-paths bounded-detail');
      pathFields.tabIndex = 0;
      pathFields.setAttribute('role', 'region');
      pathFields.setAttribute('aria-label', child ? 'Package call details' : 'Executable paths');
      const packagePath = element('dd'), executionPath = element('dd');
      if (child) pathFields.append(element('dt', 'Observation ID'), id, element('dt', 'Event source'), source,
        element('dt', 'Source type'), sourceType);
      pathFields.append(element('dt', 'Package path'), packagePath, element('dt', 'Execution path'), executionPath);
      paths.append(summary, pathFields);
      if (child) cells[0].append(callPath, paths);
      else cells[1].append(packageName, paths);
      const times = { started_at: cells[columns.started_at], ended_at: cells[columns.ended_at] };
      cells[columns.state].append(element('span', undefined, child ? 'observation-state' : 'result-badge'));
      row.append(...cells);
      record = {
        node: row,
        cells,
        times,
        name,
        packageName,
        id,
        source,
        sourceType,
        callPath,
        paths,
        summary,
        packagePath,
        executionPath,
        item: null
      };
      rows.set(item[idKey], record);
    }
    text(record.name, literal(child ? item.package_name : item.name));
    if (child) {
      // A readable path projection, not a reconstructed package graph. Keep the raw path below.
      const path = item.execution_path.startsWith('\\') ? item.execution_path.slice(1) : item.execution_path;
      text(record.callPath, `Call path: ${path.replaceAll('\\', ' › ')}`);
      text(record.id, formatId(item.observation_id));
      text(record.source, literal(item.source_name));
      text(record.sourceType, item.source_type === null ? '—' : String(item.source_type));
    } else {
      text(record.cells[0], formatId(item.statistics_id));
      text(record.packageName, `Package: ${literal(item.package_name)} · Executable ID: ${formatId(item.executable_id)}`);
    }
    text(record.packagePath, literal(item.package_path));
    text(record.executionPath, literal(item.execution_path));
    for (const key of ['started_at', 'ended_at']) {
      if (!record.item || record.item[key] !== item[key] || record.executionStart !== executionStart) {
        if (item[key] === null) record.times[key].textContent = '—';
        else {
          const time = element('time', display.tableTimestamp(item[key], executionStart));
          time.setAttribute('datetime', item[key]);
          time.title = item[key];
          record.times[key].replaceChildren(time);
        }
      }
    }
    text(record.cells[columns.duration], display.duration(item.duration_seconds));
    text(record.cells[columns.state].firstChild,
      child ? item.state === 'complete' ? 'Start/end recorded' : 'End unconfirmed' : formatCode(item.result));
    if (!child) record.cells[columns.state].firstChild.dataset.result = item.result?.name === 'unknown' ? 'unknown'
      : String(item.result?.code ?? '');
    record.item = item;
    record.executionStart = executionStart;
    return record;
  }
  return view.mount({
    paintRow,
    loading: `Loading ${singular} observations…`,
    notLoaded: 'No observations loaded.',
    previousPage: 'Previous observation page shown.',
    emptyMessage: (page, number) => number > 1 ? 'No observations remain on this page. Use Previous or First page.'
      : page.meta.availability === 'not-recorded' ? `No ${singular} observations recorded. Logging was disabled.`
        : page.meta.availability === 'unknown' ? `No ${singular} observations. Recording coverage is unknown.`
          : `No ${singular} observations.`,
    pageInfo(page, state) {
      const coverage = page.meta.availability === 'available' ? ' · recording: recorded'
        : page.meta.availability === 'not-recorded' ? ' · Not recorded' : ' · Recording coverage unknown';
      return `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} `
        + `${child ? 'calls on this page' : 'executables'}${coverage}`
        + (child && page.meta.has_unidentified_starts
          ? ' · Some starts have no public numeric ID and cannot be paged. Coverage is unknown.' : '');
    }
  });
}
