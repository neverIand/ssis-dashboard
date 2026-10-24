import { ApiError } from './api.js';
import { formatId } from './display.js';
import { observationText, readObservationMeta } from './observation-page.js';

export function parameterQuery(value, metadata) {
  if ((value.section !== undefined && value.section !== 'parameters') || value.sort !== undefined
      || value.direction !== undefined || !Number.isSafeInteger(value.limit)
      || value.limit < 1 || value.limit > metadata.limits.max_limit) throw new TypeError();
  return { section: 'parameters', limit: value.limit };
}

export function readParameterPage(response, _executionId, query, metadata, display) {
  try {
    readObservationMeta(response, { ...query, sort: 'execution_parameter_id', direction: 'asc' },
      metadata, display, { availability: false });
    if (response.meta.section !== 'parameters') throw new TypeError();
    let previous = 0n;
    for (const row of response.data) {
      if (row.execution_parameter_id === null) throw new TypeError();
      formatId(row.execution_parameter_id);
      const id = BigInt(row.execution_parameter_id);
      if (id <= previous || id > BigInt(response.meta.upper_id)) throw new TypeError();
      previous = id;
      const code = row.object_type?.code;
      if (!Number.isSafeInteger(code) || code < -32768 || code > 32767
          || row.object_type.name !== ({ 20: 'project', 30: 'package', 50: 'system' }[code] ?? 'unknown')) throw new TypeError();
      for (const field of ['name', 'sql_type']) {
        if (row[field] === null) throw new TypeError();
        observationText(row[field], 128, true);
      }
      if (!row.name || row.name.includes('\0')) throw new TypeError();
      for (const field of ['sensitive', 'required', 'value_set', 'runtime_override', 'redacted', 'truncated']) {
        if (typeof row[field] !== 'boolean') throw new TypeError();
      }
      if (row.sensitive && (!row.redacted || row.redaction_reason !== 'sensitive')) throw new TypeError();
      if (row.redacted) {
        // Never inspect or stringify text supplied in violation of the redaction contract.
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
