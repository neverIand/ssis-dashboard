import { createDisplay, formatCode, formatId } from './display.js';

export function mountObservationTable(root, { metadata, actions, restoreView = null, resource = 'executables' }) {
  const child = resource === 'children', singular = child ? 'package call' : 'executable';
  const idKey = child ? 'observation_id' : 'statistics_id';
  const columns = child ? { count: 4, name: 0, timing: 1, duration: 2, state: 3 }
    : { count: 6, name: 1, timing: 3, duration: 4, state: 5 };
  const document = root.ownerDocument;
  const get = name => root.querySelector(`[data-${resource}-${name}]`);
  const toggle = get('toggle'), panel = get('panel'), status = get('status'), notice = get('notice');
  const retry = get('retry'), sort = get('sort'), direction = get('direction'), limit = get('limit');
  const previous = get('previous'), next = get('next'), latest = get('latest');
  const region = get('scroll'), table = get('table'), body = table.querySelector('tbody');
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const rows = new Map(), controls = { toggle, retry, sort, direction, limit, previous, next, latest, region };
  const initialFocus = document.activeElement;
  const initialScroll = { left: region.scrollLeft, top: region.scrollTop };
  let returning = restoreView, rendered = null, renderedStart = null, current = null, busy = true;
  limit.max = String(metadata.limits.max_limit);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const literal = value => value === null ? '—' : value === '' ? '(empty)' : value;
  function empty(message) {
    rows.clear();
    const row = element('tr'), cell = element('td', message, 'empty-state');
    cell.colSpan = columns.count;
    row.append(cell);
    body.replaceChildren(row);
  }
  function paint(page, pageNumber, executionStart) {
    if (!page.data.length) {
      empty(pageNumber > 1 ? 'No observations remain on this page. Use Previous or Show latest.'
        : page.meta.availability === 'not-recorded' ? `No ${singular} observations recorded. Logging was disabled.`
          : page.meta.availability === 'unknown' ? `No ${singular} observations on this page. Recording coverage is unknown.`
            : `No ${singular} observations on this page.`);
      return;
    }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set();
    let anchor = body.firstChild;
    for (const item of page.data) {
      wanted.add(item[idKey]);
      let record = rows.get(item[idKey]);
      if (!record) {
        const row = element('tr');
        row.dataset[child ? 'observationId' : 'statisticsId'] = item[idKey];
        const cells = Array.from({ length: columns.count }, (_, i) => element('td', undefined,
          i === columns.timing ? 'time-cell observation-times' : i === columns.duration ? 'number-cell' : !child && i === 0 ? 'id-cell' : ''));
        const name = element('span', undefined, child ? 'package-call-name' : '');
        const packageName = element('span', undefined, 'cell-detail');
        const id = element(child ? 'dd' : 'span', undefined, child ? '' : 'cell-detail');
        const source = element('dd'), sourceType = element('dd'), callPath = element('span', undefined, 'cell-detail call-path');
        cells[columns.name].className = child ? 'observation-name package-call' : 'observation-name';
        cells[columns.name].append(name);
        const paths = element('details'), summary = element('summary', child ? 'Details' : 'Paths');
        const pathFields = element('dl', undefined, 'observation-paths');
        const packagePath = element('dd'), executionPath = element('dd');
        if (child) pathFields.append(element('dt', 'Observation ID'), id, element('dt', 'Event source'), source,
          element('dt', 'Source type'), sourceType);
        pathFields.append(element('dt', 'Package path'), packagePath, element('dt', 'Execution path'), executionPath);
        paths.append(summary, pathFields);
        if (child) cells[0].append(callPath, paths);
        else { cells[1].append(packageName, id); cells[2].append(paths); }
        const times = {};
        for (const [key, label] of [['started_at', 'Started'], ['ended_at', 'Ended']]) {
          const line = element('div');
          times[key] = element('span');
          line.append(element('span', label, 'cell-detail'), times[key]);
          cells[columns.timing].append(line);
        }
        cells[columns.state].append(element('span', undefined, child ? 'observation-state' : 'result-badge'));
        row.append(...cells);
        record = { row, cells, times, name, packageName, id, source, sourceType, callPath,
          paths, summary, packagePath, executionPath, item: null };
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
        text(record.packageName, `Package: ${literal(item.package_name)}`);
        text(record.id, `Executable ID: ${formatId(item.executable_id)}`);
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
      text(record.cells[columns.state].firstChild, child ? item.state === 'complete' ? 'Start/end recorded' : 'End unconfirmed' : formatCode(item.result));
      if (!child) record.cells[columns.state].firstChild.dataset.result = item.result?.name === 'unknown' ? 'unknown' : String(item.result?.code ?? '');
      record.item = item;
      record.executionStart = executionStart;
      if (record.row !== anchor) body.insertBefore(record.row, anchor);
      anchor = record.row.nextSibling;
    }
    for (const [id, record] of rows) if (!wanted.has(id)) { record.row.remove(); rows.delete(id); }
  }
  const listeners = [];
  function listen(node, event, action) { node.addEventListener(event, action); listeners.push([node, event, action]); }
  const syncOrder = query => {
    for (const [node, value] of [[sort, query.sort], [direction, query.direction], [limit, String(query.limit)]]) {
      if (document.activeElement !== node) node.value = value;
    }
  };
  const order = () => {
    if (busy || !current) {
      if (current) { sort.value = current.query.sort; direction.value = current.query.direction; limit.value = String(current.query.limit); }
      return;
    }
    const size = Number(limit.value);
    if (!Number.isSafeInteger(size) || size < 1 || size > metadata.limits.max_limit) {
      notice.textContent = `Rows per page must be between 1 and ${metadata.limits.max_limit}.`;
      return;
    }
    actions.order({ sort: sort.value, direction: direction.value, limit: size });
  };
  listen(toggle, 'click', actions.toggle);
  listen(retry, 'click', actions.retry);
  listen(previous, 'click', actions.previous);
  listen(next, 'click', actions.next);
  listen(latest, 'click', actions.latest);
  for (const node of [sort, direction, limit]) listen(node, 'change', order);
  return {
    render(state, isBusy, authorized, executionStart = null) {
      current = state; busy = isBusy;
      if (!state.open) returning = null;
      const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
      const position = { left: region.scrollLeft, top: region.scrollTop };
      panel.hidden = !state.open || !authorized;
      for (const node of [retry, sort, direction, limit, previous, next, latest]) {
        node.disabled = !authorized || !state.open;
        node.setAttribute('aria-disabled', String(busy));
      }
      previous.setAttribute('aria-disabled', String(busy || !state.hasPrevious));
      next.setAttribute('aria-disabled', String(busy || !state.hasNext));
      retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      table.setAttribute('aria-busy', String(busy));
      syncOrder(state.query);
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      if (page !== rendered || page === null || executionStart !== renderedStart) {
        if (page) paint(page, state.pageNumber, executionStart);
        else empty(state.phase === 'loading' ? `Loading ${singular} observations…` : 'No observations loaded.');
        rendered = page;
        renderedStart = executionStart;
      }
      status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
      const coverage = page?.meta.availability === 'available' ? '' : page?.meta.availability === 'not-recorded' ? ' · Not recorded' : ' · Recording coverage unknown';
      const pageInfo = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} ${child ? 'calls on this page' : 'rows'}${coverage}${child && page.meta.has_unidentified_starts ? ' · Some starts have no public numeric ID and cannot be paged. Coverage is unknown.' : ''}` : '';
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ' Previous observation page shown. ' : ' '}${pageInfo}`
        : state.stale ? `Refreshing… Previous observation page shown. ${pageInfo}`
          : state.phase === 'loading' ? `Loading ${singular} observations…` : pageInfo;
      if (panel.hidden && panelFocused && authorized) toggle.focus({ preventScroll: true });
      else if (focused === retry && retry.hidden) toggle.focus({ preventScroll: true });
      else if (authorized && rowFocused && document.activeElement !== focused) (focused.isConnected ? focused : region).focus({ preventScroll: true });
      region.scrollLeft = position.left;
      region.scrollTop = position.top;
      if (returning && page && !busy) {
        for (const id of returning.openPaths ?? []) if (rows.has(id)) rows.get(id).paths.open = true;
        if (document.activeElement === initialFocus) {
          (rows.get(returning.focusId)?.summary ?? controls[returning.focus])?.focus({ preventScroll: true });
        }
        if (region.scrollLeft === initialScroll.left && region.scrollTop === initialScroll.top) {
          region.scrollLeft = returning.left; region.scrollTop = returning.top;
        }
        returning = null;
      }
    },
    checkpoint() {
      return { left: region.scrollLeft, top: region.scrollTop,
        openPaths: [...rows].filter(([, record]) => record.paths.open).map(([id]) => id),
        focusId: [...rows].find(([, record]) => record.summary === document.activeElement)?.[0] ?? null,
        focus: Object.keys(controls).find(key => controls[key] === document.activeElement) ?? null };
    },
    dispose() {
      for (const [node, event, action] of listeners) node.removeEventListener(event, action);
      rows.clear(); body.replaceChildren(); status.textContent = notice.textContent = status.title = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true;
      returning = rendered = current = null;
    },
  };
}
