import assert from 'node:assert/strict';
import test from 'node:test';

import { startApp } from '../src/app.js';
import { mountDetailScreen } from '../src/detail-screen.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { envelope, jsonResponse, metadata } from './fixtures.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(...named) {
  const screen = named.length ? named[0] : 'overview';
  const status = { textContent: '', hidden: true }, log = [];
  const root = { dataset: { screen }, querySelector: selector => { assert.equal(selector, '[data-app-status]'); return status; } };
  const window = new EventTarget();
  let mounts = 0;
  const make = name => (target, saved) => {
    const id = `${name}${++mounts}`;
    let live = true;
    log.push(['mount', id, saved]);
    assert.equal(target, root);
    // Like the real screens, a disposed screen has nothing left to save.
    return { dispose: () => { live = false; log.push(['dispose', id]); },
      checkpoint: () => { log.push(['checkpoint', id]); return live ? { from: id } : null; } };
  };
  const options = { window, screens: { overview: make('overview'), execution: make('execution'), history: make('history') },
    mountTips: () => { log.push(['tips']); return () => log.push(['tips off']); } };
  const page = (type, persisted) => window.dispatchEvent(Object.assign(new Event(type), { persisted }));
  return { root, status, log, options, page };
}

test('the screen named by the document is mounted once with nothing saved', () => {
  for (const screen of ['overview', 'execution', 'history']) {
    const app = harness(screen);
    startApp(app.root, app.options);
    assert.deepEqual(app.log, [['tips'], ['mount', `${screen}1`, null]]);
    assert.equal(app.root.dataset.startup, undefined);
    assert.equal(app.status.hidden, true);
  }
});

test('an unknown or inherited screen name reports a startup error and mounts nothing', () => {
  for (const screen of ['settings', '', undefined, 'constructor', 'toString']) {
    const app = harness(screen);
    startApp(app.root, app.options);
    assert.deepEqual(app.log, [['tips']]);
    assert.equal(app.root.dataset.startup, 'error');
    assert.equal(app.status.hidden, false);
    assert.match(app.status.textContent, /could not start/);
    // Leaving the page after a failed start has nothing to dispose except the tips.
    app.page('pagehide', false);
    assert.deepEqual(app.log, [['tips'], ['tips off']]);
  }
});

test('a screen that throws while mounting reports the same startup error', () => {
  const app = harness();
  app.options.screens.overview = () => { throw new Error('private-detail'); };
  startApp(app.root, app.options);
  assert.equal(app.root.dataset.startup, 'error');
  assert.doesNotMatch(app.status.textContent, /private-detail/);
});

test('a retained document hands its checkpoint to the restarted screen, once', () => {
  const app = harness('history');
  startApp(app.root, app.options);
  app.page('pagehide', true);
  // The checkpoint is taken before the screen is disposed.
  assert.deepEqual(app.log.slice(2), [['checkpoint', 'history1'], ['dispose', 'history1'], ['tips off']]);
  app.page('pageshow', true);
  // The restart disposes again (harmless) and remounts with what the first screen saved.
  assert.deepEqual(app.log.slice(5), [['dispose', 'history1'], ['tips off'], ['tips'], ['mount', 'history2', { from: 'history1' }]]);
  // A second restore without a new pagehide has nothing saved.
  app.page('pageshow', true);
  assert.deepEqual(app.log.at(-1), ['mount', 'history3', null]);
});

test('a document that is not retained saves nothing and an ordinary pageshow does not restart', () => {
  const app = harness();
  startApp(app.root, app.options);
  app.page('pageshow', false);
  assert.equal(app.log.length, 2);
  app.page('pagehide', false);
  assert.deepEqual(app.log.slice(2), [['dispose', 'overview1'], ['tips off']]);
  app.page('pageshow', true);
  assert.deepEqual(app.log.at(-1), ['mount', 'overview2', null]);
});

test('the detail screen checkpoints only after settings load and restores under the detail key', async t => {
  const dom = detailDOM(), calls = [];
  const id = JSON.parse(dom.document.getElementById('app-config').textContent).execution_id;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(metadata()));
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Server' }));
    return jsonResponse(detailResponse(id));
  });
  const first = mountDetailScreen(dom.root);
  assert.equal(first.checkpoint(), null);
  await settle();
  const saved = first.checkpoint();
  assert.deepEqual(Object.keys(saved), ['detail']);
  assert.equal(saved.detail.executionId, id);
  assert.ok(calls.some(path => path.endsWith(`/executions/${id}`)));
  first.dispose();
  const second = mountDetailScreen(dom.root, saved);
  t.after(second.dispose);
  await settle();
  assert.equal(second.checkpoint().detail.executionId, id);
  assert.equal(saved.detail.autoPaused, false);
  second.dispose();
  // What the screen is handed under the detail key reaches the view: a saved pause survives the restart.
  const paused = mountDetailScreen(dom.root, { detail: { ...saved.detail, autoPaused: true } });
  t.after(paused.dispose);
  await settle();
  assert.equal(paused.checkpoint().detail.autoPaused, true);
  paused.dispose();
  const ignored = mountDetailScreen(dom.root, { other: { ...saved.detail, autoPaused: true } });
  t.after(ignored.dispose);
  await settle();
  assert.equal(ignored.checkpoint().detail.autoPaused, false);
});
