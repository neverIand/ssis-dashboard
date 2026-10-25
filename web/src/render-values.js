import { formatBoolean, formatCode, formatId } from './display.js';
import { mountSectionTable } from './section-table.js';

function mountValueTable(root, { metadata, actions, restoreView = null }, resource) {
  const parameter = resource === 'parameters', identity = parameter ? 'execution_parameter_id' : 'property_id';
  const valueColumn = parameter ? 3 : 1, enabled = metadata.capabilities.values;
  const view = mountSectionTable(root, { metadata, actions, restoreView }, {
    resource,
    columns: parameter ? 5 : 3,
    identity,
    enabled,
    capability: true,
    disclosures: [{
      saved: 'values',
      field: 'value',
      focus: 'valueFocus',
      summary: 'valueSummary',
      visible: true
    }, ...!parameter ? [{ saved: 'paths', field: 'details', focus: 'pathFocus', summary: 'summary' }] : []],
    focusFallback: ['valueFocus', 'pathFocus', 'flagFocus']
  });
  const { get, rows, element, text, display } = view;
  const flags = [
    ['sensitive', 'Sensitive'],
    ['required', 'Required'],
    ['value_set', 'Value set'],
    ['runtime_override', 'Runtime override']
  ];
  function paintRow(item, row) {
    const id = item[identity];
    if (!row) {
      const node = element('tr');
      node.dataset[parameter ? 'parameterId' : 'propertyId'] = id;
      const cells = Array.from({ length: parameter ? 5 : 3 }, () => element('td'));
      cells[0].className = parameter ? 'parameter-name' : 'override-property';
      if (parameter) cells[2].className = 'parameter-type';
      const name = element('span'), identityLabel = element('span', undefined, 'cell-detail');
      cells[0].append(name);
      if (!parameter) cells[0].append(identityLabel);
      const preview = element('p', undefined, 'value-preview'), truncated = element('p', undefined, 'cell-detail');
      const value = element('details'), valueSummary = element('summary', 'View value'), full = element('p', undefined,
        'value-body bounded-detail');
      full.tabIndex = 0;
      full.setAttribute('role', 'region');
      full.setAttribute('aria-label', 'Full value');
      value.append(valueSummary, full);
      cells[valueColumn].append(preview, truncated, value);
      const details = parameter ? null : element('details'), summary = parameter ? null : element('summary', 'View path');
      const values = {}, fullPath = parameter ? null : element('p', undefined, 'override-path bounded-detail');
      let noFlags = null;
      if (parameter) {
        const list = element('div', undefined, 'flag-chips');
        noFlags = element('span', '—');
        for (const [key] of flags) {
          values[key] = element('span', undefined, 'flag-chip');
          values[key].dataset.flag = key;
          list.append(values[key]);
        }
        list.append(noFlags);
        cells[4].append(list);
      } else {
        fullPath.tabIndex = 0;
        fullPath.setAttribute('role', 'region');
        fullPath.setAttribute('aria-label', 'Property path');
        details.append(summary, fullPath);
        cells[0].append(details);
      }
      node.append(...cells);
      row = {
        node,
        cells,
        name,
        identity: identityLabel,
        preview,
        truncated,
        value,
        valueSummary,
        full,
        details,
        summary,
        values,
        fullPath,
        noFlags
      };
      rows.set(id, row);
    }
    if (parameter) {
      row.node.title = `Parameter ID: ${formatId(id)}`;
      row.node.dataset.scope = item.object_type.name;
      text(row.name, item.name);
      text(row.cells[1], formatCode(item.object_type));
      text(row.cells[2], item.sql_type === '' ? '(empty)' : item.sql_type);
      for (const [key, label] of flags) {
        text(row.values[key], item[key] ? label : '');
        row.values[key].hidden = !item[key];
      }
      row.noFlags.hidden = flags.some(([key]) => item[key]);
      text(row.noFlags, row.noFlags.hidden ? '' : '—');
    } else {
      text(row.identity, `ID: ${formatId(id)}`);
      const path = [...item.property_path];
      text(row.name, path.length > 160 ? path.slice(0, 160).join('') + '…' : item.property_path);
      text(row.fullPath, item.property_path);
      text(row.cells[2], formatBoolean(item.sensitive));
    }
    const value = item.redacted ? `Redacted (${item.redaction_reason})` : item.value === null ? 'NULL (unredacted)' : item.value === ''
      ? '(empty)' : item.value;
    const characters = [...value];
    text(row.preview, characters.length > 160 ? characters.slice(0, 160).join('') + '…' : value);
    // Clear old text when a value becomes redacted; hidden content is not a redaction boundary.
    text(row.full, item.redacted ? '' : item.value ?? '');
    row.value.hidden = item.redacted || item.value === null || characters.length <= 160 && !item.truncated;
    if (row.value.hidden) row.value.open = false;
    row.truncated.hidden = !item.truncated;
    text(row.truncated, item.truncated ? `Truncated to ${metadata.limits.max_text_characters} characters.` : '');
    return row;
  }
  return view.mount({
    paintRow,
    loading: `Loading ${resource}…`,
    notLoaded: `No ${resource} loaded.`,
    previousPage: `Previous ${parameter ? 'parameter' : 'override'} page shown.`,
    emptyMessage: (page, number) => number > 1 ? `No ${resource} remain on this page. Use Previous or First page.` : `No ${resource}.`,
    availability() {
      if (!parameter) get('policy').hidden = !enabled || metadata.capabilities.override_values;
    },
    pageInfo: (page, state) => `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} ${resource}`
  });
}
export const mountParameters = (root, options) => mountValueTable(root, options, 'parameters');
export const mountOverrides = (root, options) => mountValueTable(root, options, 'overrides');
