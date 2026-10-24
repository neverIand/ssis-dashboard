import { metadata, wireTime } from './fixtures.js';
import { executablePage } from './executable-fixture.js';

export function eventMetadata(enabled = true) {
  const value = metadata(); value.capabilities.events = enabled;
  value.event_kinds = ['all', 'errors', 'warnings', 'duplicate-warnings', 'memory-warnings'];
  return value;
}

export const eventRow = (id = '1', changes = {}) => ({ event_id: id, execution_id: '17', message_time: wireTime,
  event_name: 'OnWarning', message_type: 110, source_type: null, message: '<b>literal 影狼</b>\r\nSecond line',
  truncated: false, package_name: 'Probe.dtsx', package_path: '\\Package', execution_path: '\\Parent\\Task ',
  source_name: '', subcomponent_name: null, ...changes });

export const eventPage = (rows = [eventRow()], changes = {}) => executablePage(rows,
  { sort: 'message_time', has_unidentified_events: false, ...changes });
