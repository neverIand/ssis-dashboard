import { ApiError } from './api.js';
import { formatId } from './display.js';
import { observationText, readObservationMeta } from './observation-page.js';

const identities = { parameters: 'execution_parameter_id', overrides: 'property_id' };
function valueQuery(value, metadata, section) {
  if ((value.section !== undefined && value.section !== section) || value.sort !== undefined
      || value.direction !== undefined || !Number.isSafeInteger(value.limit)
      || value.limit < 1 || value.limit > metadata.limits.max_limit) throw new TypeError();
  return { section, limit: value.limit };
}
export const parameterQuery = (value, metadata) => valueQuery(value, metadata, 'parameters');
export const overrideQuery = (value, metadata) => valueQuery(value, metadata, 'overrides');

function readValuePage(response, query, metadata, display, section) {
  try {
    const identity = identities[section];
    readObservationMeta(response, { ...query, sort: identity, direction: 'asc' }, metadata, display, { availability: false });
    if (response.meta.section !== section) throw new TypeError();
    let previous = 0n;
    for (const row of response.data) {
      if (row[identity] === null) throw new TypeError();
      formatId(row[identity]);
      const id = BigInt(row[identity]);
      if (id <= previous || id > BigInt(response.meta.upper_id)) throw new TypeError();
      previous = id;
      for (const field of ['sensitive', 'redacted', 'truncated']) if (typeof row[field] !== 'boolean') throw new TypeError();
      if (section === 'parameters') {
        const code = row.object_type?.code;
        if (!Number.isSafeInteger(code) || code < -32768 || code > 32767
            || row.object_type.name !== ({ 20: 'project', 30: 'package', 50: 'system' }[code] ?? 'unknown')) throw new TypeError();
        for (const field of ['name', 'sql_type']) {
          if (row[field] === null) throw new TypeError();
          observationText(row[field], 128, true);
        }
        if (!row.name || row.name.includes('\0')) throw new TypeError();
        for (const field of ['required', 'value_set', 'runtime_override']) if (typeof row[field] !== 'boolean') throw new TypeError();
      } else {
        if (typeof row.property_path !== 'string' || !row.property_path || row.property_path.includes('\0')) throw new TypeError();
        observationText(row.property_path, 4000, true);
        if (!metadata.capabilities.override_values && !row.sensitive
            && (!row.redacted || row.redaction_reason !== 'policy')) throw new TypeError();
      }
      if (row.sensitive && (!row.redacted || row.redaction_reason !== 'sensitive')) throw new TypeError();
      if (row.redacted) {
        // Never inspect or stringify text supplied in violation of sensitivity or policy.
        if (row.value !== null || row.truncated || !['sensitive', 'policy'].includes(row.redaction_reason)
            || (row.redaction_reason === 'sensitive' && !row.sensitive)) throw new TypeError();
      } else {
        if (row.redaction_reason !== null) throw new TypeError();
        observationText(row.value, metadata.limits.max_text_characters);
        if (row.truncated && (row.value === null || [...row.value].length !== metadata.limits.max_text_characters)) throw new TypeError();
      }
    }
    return response;
  } catch { throw new ApiError('invalid_response', { requestId: response?.meta?.request_id }); }
}
export const readParameterPage = (response, _executionId, query, metadata, display) => readValuePage(response, query, metadata, display, 'parameters');
export const readOverridePage = (response, _executionId, query, metadata, display) => readValuePage(response, query, metadata, display, 'overrides');
