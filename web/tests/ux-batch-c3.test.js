import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountBootstrap } from '../src/bootstrap.js';
import { createDisplay } from '../src/display.js';
import { detailFields, readExecutionDetail } from '../src/detail.js';
import { mountDetail } from '../src/render-detail.js';
import { envelope, jsonResponse, wireTime } from './fixtures.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';

const id = '9223372036854775807';
const display = createDisplay({ timeZone: 'Europe/London', locale: 'en-GB' });
const settle = () => new Promise(resolve => setImmediate(resolve));
const nb = text => text.replaceAll(' ', ' ');
// wireTime is 2026-10-17T16:00:00Z; a 25-minute mean ends 16:25.
const estimate = (changes = {}) => ({ method: 'mean_last_5_successful', sample_count: 5, duration_seconds: 1500,
  ended_at: '2026-10-17T16:25:00.0000000Z', ...changes });
const running = (value = estimate()) => {
  const response = runningDetailResponse(id);
  response.data.estimate = value;
  return response;
};

test('C3: detail accepts a null or valid active estimate and projects typical duration, end and sample count', () => {
  assert.equal(readExecutionDetail(detailResponse(id), id, display).data.estimate, null);
  const response = running();
  assert.equal(readExecutionDetail(response, id, display), response);
  // Same local day: the end shows the clock only; each part keeps no-break spaces so wrapping falls between parts.
  const text = detailFields(response, display).estimate;
  assert.equal(text, nb('25 min 00 s') + ' · ' + nb('ends 17:25:00') + ' · ' + nb('avg of 5'));
  // An end on another local day keeps its date.
  const late = running(estimate({ duration_seconds: 32400, ended_at: '2026-10-18T01:00:00.0000000Z' }));
  assert.equal(detailFields(late, display).estimate, nb('9 h 00 min') + ' · ' + nb('ends 2026-10-18 02:00:00') + ' · ' + nb('avg of 5'));
  assert.equal(detailFields(running(null), display).estimate, '—');
  assert.equal(readExecutionDetail(running(estimate({ sample_count: 1, ended_at: wireTime, duration_seconds: 1e-7 })),
    id, display).data.estimate.sample_count, 1);
});

test('C3: detail rejects a missing, ended, unstarted or malformed estimate', () => {
  const missing = running(); delete missing.data.estimate;
  const ended = detailResponse(id); ended.data.estimate = estimate();
  const unstarted = running(); Object.assign(unstarted.data, { started_at: null, elapsed_seconds: null });
  const cases = [missing, ended, unstarted, ...[{ method: 'median' }, { sample_count: 0 }, { sample_count: 6 },
    { sample_count: 2.5 }, { duration_seconds: 0 }, { duration_seconds: -1 }, { ended_at: null },
    { ended_at: '2026-10-17T15:59:59.9999999Z' }, { ended_at: 'soon' }].map(changes => running(estimate(changes)))];
  for (const response of cases) {
    assert.throws(() => readExecutionDetail(response, id, display),
      error => error instanceof ApiError && error.kind === 'invalid_response', JSON.stringify(response.data.estimate));
  }
});

test('C3: the summary shows Typical run only while active with an estimate, and hides it after the run ends', async t => {
  const dom = detailDOM(), responses = [running(), running(null), detailResponse(id)];
  let current = responses[0];
  t.mock.method(globalThis, 'fetch', async url => jsonResponse(url.pathname.endsWith('/meta') ? envelope()
    : url.pathname.endsWith('/executables') ? executablePage([]) : current));
  const dispose = mountBootstrap(dom.root, { ready: (metadata, api, config) =>
    mountDetail(dom.root, { metadata, api, executionId: id, appBase: config.app_base, autoRefresh: false }).dispose });
  t.after(dispose);
  await settle();
  assert.equal(dom.get('active-elapsed').hidden, false);
  assert.equal(dom.get('active-estimate').hidden, false);
  assert.equal(dom.field('estimate').textContent, nb('25 min 00 s') + ' · ' + nb('ends 17:25:00') + ' · ' + nb('avg of 5'));
  assert.equal(dom.field('estimate').title, 'Mean of 5 earlier successful runs · expected end 2026-10-17T16:25:00.0000000Z');
  assert.doesNotMatch(dom.field('estimate').textContent, /%/);
  for (const [response, elapsedHidden] of [[responses[1], false], [responses[2], true]]) {
    current = response;
    dom.get('detail-refresh').dispatchEvent(new Event('click'));
    await settle(); await settle();
    assert.equal(dom.get('active-elapsed').hidden, elapsedHidden);
    assert.equal(dom.get('active-estimate').hidden, true);
    assert.equal(dom.field('estimate').title, '');
  }
});
