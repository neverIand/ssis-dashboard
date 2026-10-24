import { envelope, metadata, wireTime } from './fixtures.js';

export function overrideMetadata(values = true, overrideValues = true) {
  const value = metadata();
  Object.assign(value.capabilities, { values, override_values: overrideValues });
  return value;
}
export const overrideRow = (id = '1', changes = {}) => ({ property_id: id,
  property_path: '\\Package\\<b>Connection 影狼</b>.Properties[ConnectionString] ',
  sensitive: false, value: '1.2300', truncated: false, redacted: false, redaction_reason: null, ...changes });
export const overridePage = (data = [overrideRow()], meta = {}) => ({ ...envelope(data),
  meta: { ...envelope().meta, from: null, to: null, limit: 50, sort: 'property_id', direction: 'asc',
    as_of: wireTime, upper_id: '9223372036854775807', has_more: false, next_cursor: null,
    consistency: 'live', section: 'overrides', ...meta } });
