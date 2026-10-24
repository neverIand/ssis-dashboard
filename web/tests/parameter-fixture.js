import { envelope, metadata, wireTime } from './fixtures.js';

export function parameterMetadata(enabled = true) {
  const value = metadata(); value.capabilities.values = enabled; return value;
}
export const parameterRow = (id = '1', changes = {}) => ({ execution_parameter_id: id,
  object_type: { code: 30, name: 'package' }, name: '<b>Parameter 影狼</b> ', sql_type: 'Decimal(18,4)',
  sensitive: false, required: true, value_set: true, runtime_override: false,
  value: '1.2300', truncated: false, redacted: false, redaction_reason: null, ...changes });
export const parameterPage = (data = [parameterRow()], meta = {}) => ({ ...envelope(data),
  meta: { ...envelope().meta, from: null, to: null, limit: 50, sort: 'execution_parameter_id', direction: 'asc',
    as_of: wireTime, upper_id: '9223372036854775807', has_more: false, next_cursor: null,
    consistency: 'live', section: 'parameters', ...meta } });
