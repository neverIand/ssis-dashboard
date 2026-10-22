import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, metadata } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executable, executablePage } from './executable-fixture.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const paths = row => row.children[2].firstChild;
function mount(t, get, restoreView) {
  const dom = detailDOM(), calls = [];
  const screen = mountDetail(dom.root, { metadata: metadata(), executionId: '17', appBase: '/ops/app/', restoreView,
    api: { get(resource, options) { calls.push({ resource, ...options }); return get(resource, options); } } });
  t.after(() => screen.dispose());
  const click = key => dom.get(`executables-${key}`).dispatchEvent(new Event('click'));
  return { dom, screen, calls, click };
}

test('closed observations send no request; keyed rows preserve literal paths, expansion and moved focus during refresh', async t => {
  const pending = deferred(); let sections = 0;
  const run = mount(t, async resource => !resource.endsWith('/executables') ? detailResponse('17')
    : ++sections === 1 ? executablePage([executable('1'), executable('2')]) : pending.promise);
  await settle(); assert.equal(run.calls.length, 1);
  run.click('toggle'); await settle();
  const { dom } = run, row = dom.body.children[0], summary = paths(row).firstChild;
  assert.equal(dom.body.children.length, 2);
  assert.match(dom.body.textContent, /<b>Task 影狼<\/b>/);
  assert.match(dom.body.textContent, /\(empty\)/);
  assert.equal(row.children.length, 6);
  assert.equal(row.children[3].children[0].firstChild.textContent, 'Started');
  assert.equal(row.children[3].children[1].firstChild.textContent, 'Ended');
  assert.equal(row.children[3].children[0].children[1].firstChild.attributes.get('datetime'), '2026-10-17T16:00:00.1234567Z');
  assert.equal(row.children[3].children[1].children[1].textContent, '—');
  paths(row).open = true; summary.focus();
  dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  run.click('next'); dom.get('detail-refresh').dispatchEvent(new Event('click'));
  dom.get('overview-link').focus(); dom.get('executables-scroll').scrollLeft = 160;
  pending.resolve(executablePage([executable('1', { name: 'Updated' }), executable('3')])); await settle();
  assert.equal(run.calls.length, 4);
  assert.equal(dom.body.children[0], row);
  assert.equal(paths(row).firstChild, summary);
  assert.equal(paths(row).open, true);
  assert.equal(dom.document.activeElement, dom.get('overview-link'));
  assert.equal(dom.get('executables-scroll').scrollLeft, 160);
  assert.match(dom.body.textContent, /Updated/);
});

test('empty availability is explicit and invalid page size sends no request', async t => {
  let availability = 'unknown';
  const run = mount(t, async (resource, { params }) => !resource.endsWith('/executables') ? detailResponse('17')
    : executablePage([], { ...params, availability }));
  await settle(); run.click('toggle'); await settle();
  assert.match(run.dom.body.textContent, /coverage is unknown/);
  availability = 'not-recorded';
  run.dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.match(run.dom.body.textContent, /Logging was disabled/);
  const count = run.calls.length;
  run.dom.get('executables-limit').value = '201';
  run.dom.get('executables-limit').dispatchEvent(new Event('change'));
  assert.equal(run.calls.length, count);
  assert.match(run.dom.get('executables-notice').textContent, /between 1 and 200/);
});

test('section denial retains base identity; a later 404 clears it and moves removed row focus to main', async t => {
  let failure = null;
  const run = mount(t, async resource => {
    if (!resource.endsWith('/executables')) return detailResponse('17');
    if (failure) throw failure;
    return executablePage();
  });
  await settle(); run.click('toggle'); await settle();
  paths(run.dom.body.children[0]).firstChild.focus();
  failure = new ApiError('http', { status: 403 });
  run.dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.dom.get('execution-detail').hidden, false);
  assert.equal(run.dom.field('folder').textContent, 'Folder 影狼');
  assert.doesNotMatch(run.dom.body.textContent, /Task 影狼/);
  failure = null; run.click('retry'); await settle();
  paths(run.dom.body.children[0]).firstChild.focus();
  failure = new ApiError('http', { status: 404 });
  run.dom.get('detail-refresh').dispatchEvent(new Event('click')); await settle();
  assert.equal(run.dom.get('execution-detail').hidden, true);
  assert.equal(run.dom.document.activeElement, run.dom.main);
  assert.doesNotMatch(run.dom.body.textContent, /Task 影狼/);
});

test('retained open section restores only current path/view anchors after new requests and clears on disposal', async t => {
  const get = async resource => resource.endsWith('/executables') ? executablePage() : detailResponse('17');
  const first = mount(t, get); await settle(); first.click('toggle'); await settle();
  const row = first.dom.body.children[0];
  paths(row).open = true; paths(row).firstChild.focus();
  first.dom.get('executables-scroll').scrollLeft = 90;
  const checkpoint = first.screen.checkpoint();
  assert.doesNotMatch(JSON.stringify(checkpoint), /Task|Package|execution_path|duration_seconds/);
  first.screen.dispose();
  const next = mount(t, get, checkpoint); await settle();
  assert.equal(next.calls.length, 2);
  assert.equal(paths(next.dom.body.children[0]).open, true);
  assert.equal(next.dom.document.activeElement, paths(next.dom.body.children[0]).firstChild);
  assert.equal(next.dom.get('executables-scroll').scrollLeft, 90);
  next.screen.dispose(); next.click('toggle'); await settle();
  assert.equal(next.calls.length, 2);
  assert.equal(next.dom.body.children.length, 0);
});
