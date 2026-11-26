import { badResponse } from './api.js';
import { formatId } from './display.js';
import { catalogName, packageNameUnits } from './selection.js';

// The identity field of each catalog list: folder_id, project_id or package_id.
export const navigationId = kind => `${kind.slice(0, -1)}_id`;

export function readNavigation(response, kind, limit) {
  const invalid = () => { throw badResponse(response); };
  const { data, meta } = response;
  if (!Array.isArray(data) || data.length > limit || meta?.limit !== limit
      || meta.sort !== 'name' || meta.direction !== 'asc' || meta.from !== null || meta.to !== null
      || typeof meta.has_more !== 'boolean'
      || (meta.has_more ? typeof meta.next_cursor !== 'string' || !meta.next_cursor || !data.length
        : meta.next_cursor !== null)) invalid();
  const ids = new Set(), parents = kind === 'packages' ? ['project', 'folder'] : kind === 'projects' ? ['folder'] : [];
  try {
    for (const row of data) {
      const id = row[navigationId(kind)];
      if (typeof id !== 'string' || ids.has(id)) invalid();
      formatId(id);
      ids.add(id);
      catalogName(row.name, kind === 'packages' ? packageNameUnits : undefined);
      if (row.description !== null && (typeof row.description !== 'string' || row.description.length > 1024)) invalid();
      for (const parent of parents) {
        if (typeof row[`${parent}_id`] !== 'string') invalid();
        formatId(row[`${parent}_id`]);
        catalogName(row[`${parent}_name`]);
      }
    }
  } catch { invalid(); }
  return data;
}
