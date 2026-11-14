import { ApiError } from './api.js';
import { formatId } from './display.js';
import { catalogName } from './selection.js';

export function readNavigation(response, kind, limit) {
  const invalid = () => { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); };
  const { data, meta } = response;
  if (!Array.isArray(data) || data.length > limit || meta?.limit !== limit
      || meta.sort !== 'name' || meta.direction !== 'asc' || meta.from !== null || meta.to !== null
      || typeof meta.has_more !== 'boolean'
      || (meta.has_more ? typeof meta.next_cursor !== 'string' || !meta.next_cursor || !data.length
        : meta.next_cursor !== null)) invalid();
  const ids = new Set();
  try {
    for (const row of data) {
      const id = row[kind === 'folders' ? 'folder_id' : 'project_id'];
      if (typeof id !== 'string' || ids.has(id)) invalid();
      formatId(id);
      ids.add(id);
      catalogName(row.name);
      if (row.description !== null && (typeof row.description !== 'string' || row.description.length > 1024)) invalid();
      if (kind === 'projects') {
        if (typeof row.folder_id !== 'string') invalid();
        formatId(row.folder_id);
        catalogName(row.folder_name);
      }
    }
  } catch { invalid(); }
  return data;
}
