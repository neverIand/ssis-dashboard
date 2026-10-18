import { mountBootstrap } from './bootstrap.js';
import { createDisplay, formatCode } from './display.js';
import { mountFilters } from './filters.js';
import { mountOverview } from './render-overview.js';

export function mountOverviewScreen(root, saved = null) {
  const document = root.ownerDocument;
  root.querySelector('#overview-filters fieldset').disabled = true;
  for (const selector of ['[data-apply-filters]', '[data-reset-filters]',
    '[data-overview-refresh]', '[data-poll-toggle]']) root.querySelector(selector).disabled = true;
  for (const control of root.querySelectorAll('[data-order]')) control.disabled = true;
  let checkpoint = () => null;
  const dispose = mountBootstrap(root, { ready(metadata, api, config) {
    const options = [{ code: '', name: 'All statuses' }, ...metadata.execution_statuses];
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
    const display = createDisplay({ timeZone: metadata.display_timezone });
    root.querySelector('#creation-window option').textContent =
      `Default window (${display.count(metadata.limits.default_range_hours)} h)`;
    const overview = mountOverview(root, { metadata, api, executionBase: config.execution_base,
      retainedPaths: saved?.paths, restoreView: saved?.view });
    if (saved) { saved.paths.length = 0; saved.view = null; }
    checkpoint = overview.checkpoint;
    const filters = mountFilters(root, { metadata, api, appBase: config.app_base,
      onApplied: (selection, options) => { void overview.apply(selection, options); } });
    return () => { filters(); overview.dispose(); };
  } });
  return { dispose, checkpoint: () => checkpoint() };
}
