// Run by detail-event-summary.test.js in a child started with --expose-gc (full review of 19 November 2026, R-03).
// After the Errors excerpt is shown, a 50-row Warnings page is read, then Executables opens: the page, its rows
// and the full error message must all become collectible while the header keeps its bounded excerpt.
import assert from 'node:assert/strict';
import { getHeapSnapshot } from 'node:v8';
import { mountDetail } from '../src/render-detail.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { eventMetadata, eventPage, eventRow } from './event-fixture.js';

assert.equal(typeof globalThis.gc, 'function', 'start with --expose-gc');
const marker = 'Retained full error message ', long = 'w'.repeat(16000), refs = [];
// A flat 16,000-character string, as a decoded HTTP response would hold it.
const messageText = (prefix = marker) => { const bytes = Buffer.alloc(16000, 'w'); bytes.write(prefix); return bytes.toString(); };
// A live string of the same size and shape: if the snapshot cannot show it, the retention check proves nothing.
const controlMarker = 'Live control message ', control = messageText(controlMarker);
const flush = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const dom = detailDOM();
dom.window.location.hash = '#events/errors';
const detail = detailResponse('17');
Object.assign(detail.data, { status: { code: 4, name: 'failed' }, error_count: 1,
  event_counts: { ...detail.data.event_counts, all: 4, errors: 1 } });
const screen = mountDetail(dom.root, { metadata: eventMetadata(), executionId: '17', appBase: '/ops/app/', api: {
  async get(resource, { params = {} } = {}) {
    if (resource.endsWith('/executables')) return executablePage();
    if (!resource.endsWith('/events')) return detail;
    // Built at run time so no copy of the message lives in this module's constants.
    const rows = params.kind === 'warnings'
      ? Array.from({ length: 50 }, (_, index) => eventRow(String(100 + index), { message: `${long}${index}`.slice(0, 16000) }))
      : [eventRow('1', { event_name: 'OnError', message_type: 120, source_name: 'Data Flow Task',
        message: messageText() })];
    const page = eventPage(rows, params);
    refs.push({ kind: params.kind, page: new WeakRef(page), row: new WeakRef(rows.at(-1)) });
    return page;
  } } });

async function largeStrings() {
  const chunks = [];
  for await (const chunk of getHeapSnapshot()) chunks.push(chunk);
  const { snapshot: { meta }, nodes, strings } = JSON.parse(Buffer.concat(chunks));
  const stride = meta.node_fields.length, [type, name, size] = ['type', 'name', 'self_size'].map(field => meta.node_fields.indexOf(field));
  assert.ok(type >= 0 && name >= 0 && size >= 0 && meta.node_types[0].includes('string'), 'heap snapshot schema');
  const found = new Set();
  for (let index = 0; index < nodes.length; index += stride) {
    if (meta.node_types[0][nodes[index + type]] !== 'string' || nodes[index + size] < 16000) continue;
    for (const prefix of [marker, controlMarker]) if (strings[nodes[index + name]].startsWith(prefix)) found.add(prefix);
  }
  return found;
}

try {
  await flush(); await flush();
  // Only the length here: comparing contents would flatten the string and hide what it references.
  assert.equal(dom.get('first-error-message').textContent.length, 2 + 200 + 1);
  dom.get('events-kind').value = 'warnings';
  dom.get('events-kind').dispatchEvent(new Event('change')); await flush(); await flush();
  assert.equal(dom.eventBody.children.length, 50, '50 Warnings rows rendered');
  dom.get('executables-toggle').dispatchEvent(new Event('click')); await flush(); await flush();
  const warnings = refs.filter(ref => ref.kind === 'warnings');
  assert.ok(warnings.length > 0);
  // Collection timing is the engine's: allow a bounded number of cycles across event-loop turns. deref() keeps
  // its target alive until the current job ends, so each check is followed by a new turn before the next gc().
  for (let cycle = 0; cycle < 20; cycle++) {
    await flush(); globalThis.gc(); await flush();
    if (!refs.some(ref => ref.page.deref() || ref.row.deref())) break;
  }
  for (const ref of refs) {
    assert.equal(ref.page.deref(), undefined, `${ref.kind} page collected`);
    assert.equal(ref.row.deref(), undefined, `${ref.kind} row collected`);
  }
  const found = await largeStrings();
  assert.ok(found.has(controlMarker) && control.length === 16000, 'the snapshot shows a live 16,000-character string');
  assert.equal(found.has(marker), false, 'the full error message is not kept by the excerpt');
  assert.equal(dom.get('first-error').hidden, false);
  assert.equal(dom.get('first-error-message').textContent, `— ${marker}${'w'.repeat(200 - marker.length)}…`);
} finally { screen.dispose(); }
