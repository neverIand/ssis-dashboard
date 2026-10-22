import { envelope, wireTime } from './fixtures.js';

export const executable = (statisticsId, changes = {}) => ({ statistics_id: statisticsId, execution_id: '17',
  executable_id: '2', name: '<b>Task 影狼</b>\r\nLine', package_name: 'Main.dtsx',
  package_path: '', execution_path: '\\Package\\Task[1] ', started_at: wireTime, ended_at: null,
  duration_seconds: null, result: null, ...changes });

export function executablePage(data = [executable('1')], meta = {}) {
  return { ...envelope(data), meta: { ...envelope().meta, from: null, to: null, limit: 50,
    sort: 'started_at', direction: 'asc', as_of: wireTime, upper_id: '9223372036854775807',
    has_more: false, next_cursor: null, consistency: 'live', availability: data.length ? 'available' : 'unknown', ...meta } };
}
