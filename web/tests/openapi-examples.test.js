import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readMetadata } from '../src/bootstrap.js';
import { childQuery, readChildPage } from '../src/children.js';
import { readExecutionDetail } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { eventQuery, readEventPage } from '../src/events.js';
import { executableQuery, readExecutablePage } from '../src/executables.js';
import { historyQuery, readHistoryPage } from '../src/history.js';
import { readNavigation } from '../src/navigation.js';
import { readExecutionPage, readSummary } from '../src/overview.js';
import { readTimeline } from '../src/timeline.js';
import { overrideQuery, parameterQuery, readOverridePage, readParameterPage } from '../src/values.js';

// A generated copy of components.examples in docs/openapi.yaml (python -m tests.export_openapi_examples).
// The Python contract tests validate the examples against the schemas and fail when this copy is stale,
// so a DTO change made on one side only fails here or there.
const examples = JSON.parse(readFileSync(new URL('./openapi-examples.json', import.meta.url), 'utf8'));
const copy = name => structuredClone(examples[name]);
const metadata = readMetadata(copy('MetaResponse').data, examples.MetaResponse.meta.request_id);
const display = createDisplay({ timeZone: metadata.display_timezone });
const section = ({ meta }) => ({ sort: meta.sort, direction: meta.direction, limit: meta.limit });
const executionId = examples.ExecutionResponse.data.execution_id;

const readers = {
  MetaResponse: response => readMetadata(response.data, response.meta.request_id),
  FoldersResponse: response => readNavigation(response, 'folders', response.meta.limit),
  ProjectsResponse: response => readNavigation(response, 'projects', response.meta.limit),
  ExecutionsResponse: response => readExecutionPage(response, {
    ...section(response), from: response.meta.from, to: response.meta.to, status: [], folder: null, project: null, package: null,
  }, metadata, display),
  ExecutionResponse: response => readExecutionDetail(response, executionId, display),
  SummaryResponse: response => readSummary(response, copy('ExecutionsResponse'), metadata, display),
  TimelineResponse: response => readTimeline(response, { status: response.meta.selected_statuses }, copy('ExecutionsResponse'),
    response.meta.bucket, metadata, display),
  ExecutablesResponse: response => readExecutablePage(response, executionId, executableQuery(section(response), metadata),
    metadata, display),
  ChildrenResponse: response => readChildPage(response, executionId, childQuery(section(response), metadata), metadata, display),
  EventsResponse: response => readEventPage(response, executionId, eventQuery({ ...section(response), kind: 'all' }, metadata),
    metadata, display),
  ParametersResponse: response => readParameterPage(response, executionId, parameterQuery({ limit: response.meta.limit }, metadata),
    metadata, display),
  OverridesResponse: response => readOverridePage(response, executionId, overrideQuery({ limit: response.meta.limit }, metadata),
    metadata, display),
  HistoryResponse: response => {
    const [row] = response.data;
    return readHistoryPage(response, null, historyQuery({ ...section(response), status: String(row.status.code) }, metadata),
      metadata, display, { folder_name: row.folder_name, project_name: row.project_name, package_name: row.package_name });
  },
};
// No DTO reader: the server label is checked inline where it is requested, and the browser never requests the probes.
const unread = ['ServerResponse', 'LivenessResponse', 'ReadinessResponse'];

test('every OpenAPI response example has a browser reader or is listed as unread', () => {
  assert.deepEqual(Object.keys(examples).sort(), [...Object.keys(readers), ...unread].sort());
});

for (const [name, read] of Object.entries(readers)) {
  test(`the ${name} example passes its browser reader`, () => {
    assert.doesNotThrow(() => read(copy(name)));
  });
}

test('the readers reject an example whose identity field is damaged', () => {
  // Guards against a reader call above that accepts anything.
  const damage = {
    ExecutionsResponse: r => { r.data[0].execution_id = 17; }, ExecutionResponse: r => { r.data.status = null; },
    ExecutablesResponse: r => { r.data[0].statistics_id = null; }, ChildrenResponse: r => { r.data[0].state = 'done'; },
    EventsResponse: r => { r.data[0].event_id = null; }, ParametersResponse: r => { r.data[0].sensitive = 'yes'; },
    OverridesResponse: r => { r.data[0].property_id = null; }, HistoryResponse: r => { r.data[0].created_at = null; },
    FoldersResponse: r => { r.data[0].name = null; }, ProjectsResponse: r => { r.data[0].folder_id = null; },
    SummaryResponse: r => { r.data.total = -1; }, TimelineResponse: r => { r.data[0].created_count = -1; },
    MetaResponse: r => { r.data.limits.max_limit = '200'; },
  };
  assert.deepEqual(Object.keys(damage).sort(), Object.keys(readers).sort());
  for (const [name, change] of Object.entries(damage)) {
    const response = copy(name);
    change(response);
    assert.throws(() => readers[name](response), undefined, name);
  }
});
