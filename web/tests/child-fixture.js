import { wireTime } from './fixtures.js';
import { executablePage } from './executable-fixture.js';

export const child = (id = '1', changes = {}) => ({ observation_id: id, execution_id: '17',
  package_name: 'Child.dtsx', package_path: '\\Package', execution_path: '\\Parent\\Run[1] ',
  source_name: '<b>Child 影狼</b>\r\nLine', source_type: null,
  started_at: wireTime, ended_at: null, duration_seconds: null, state: 'incomplete', ...changes });

export function childPage(rows = [child()], changes = {}) {
  const page = executablePage(rows, { sort: 'started_at', has_unidentified_starts: false, ...changes });
  return page;
}
