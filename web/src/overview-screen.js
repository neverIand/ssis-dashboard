import { mountBootstrap } from './bootstrap.js';
import { formatCode } from './display.js';
import { mountFilters } from './filters.js';
import { mountOverview } from './render-overview.js';

// Running, Succeeded and Failed first; the other statuses keep their code order.
export function statusChoiceOrder(statuses) {
  const common = [2, 7, 4], rank = item => common.includes(item.code) ? common.indexOf(item.code) : common.length;
  return [...statuses].sort((a, b) => rank(a) - rank(b));
}

export function mountOverviewScreen(root, saved = null) {
  const document = root.ownerDocument;
  root.querySelector('#overview-filters fieldset').disabled = true;
  for (const selector of ['[data-reset-filters]',
    '[data-overview-refresh]', '[data-poll-toggle]']) root.querySelector(selector).disabled = true;
  for (const control of root.querySelectorAll('[data-order]')) control.disabled = true;
  let checkpoint = () => null;
  const dispose = mountBootstrap(root, { ready(metadata, api, config, serverTime) {
    const options = [{ code: '', name: 'All statuses' }, ...statusChoiceOrder(metadata.execution_statuses)];
    root.querySelector('[data-status-choices]').replaceChildren(...options.map((item) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'status';
      checkbox.value = String(item.code);
      checkbox.checked = item.code === '';
      label.append(checkbox, document.createTextNode(item.code === '' ? item.name : formatCode(item)));
      return label;
    }));
    let filters;
    const overview = mountOverview(root, { metadata, api, appBase: config.app_base, serverTime,
      retainedPaths: saved?.paths, restoreView: saved?.view, onSelect: changes => filters.select(changes) });
    if (saved) { saved.paths.length = 0; saved.view = null; }
    checkpoint = overview.checkpoint;
    filters = mountFilters(root, { metadata, api, appBase: config.app_base, effectiveWindow: overview.effectiveWindow,
      onApplied: (selection, options) => { void overview.apply(selection, options); } });
    return () => { filters.dispose(); overview.dispose(); };
  } });
  return { dispose, checkpoint: () => checkpoint() };
}
