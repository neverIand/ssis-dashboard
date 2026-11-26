import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { mountSuggestions } from '../src/history-suggestions.js';
import { navigationId } from '../src/navigation.js';
import { envelope } from './fixtures.js';
import { historyMetadata, suggestionNodes } from './history-fixture.js';
import { Node } from './overview-dom.js';

// Wiring evidence on the DOM double only: no browser focus, layout or screen-reader claims.
const metadata = historyMetadata();
const settle = () => new Promise(resolve => setImmediate(resolve));
const names = count => Array.from({ length: count }, (_, index) => `Name ${String(index + 1).padStart(2, '0')}`);

function catalogPage(kind, params, all) {
  const start = Number(params.cursor ?? 0), rows = all.slice(start, start + params.limit);
  const next = start + params.limit < all.length ? String(start + params.limit) : null;
  return { ...envelope(rows.map((name, index) => ({ [navigationId(kind)]: String(start + index + 1), name, description: null,
    ...(kind === 'folders' ? {} : { folder_id: '1', folder_name: params.folder }),
    ...(kind === 'packages' ? { project_id: '2', project_name: params.project } : {}) }))),
  meta: { ...envelope().meta, from: null, to: null, limit: params.limit, sort: 'name', direction: 'asc',
    has_more: next !== null, next_cursor: next } };
}

function setup(t, { kind = 'folders', all = names(12), get = null, mode = 'exact', scope = { folder: 'F', project: 'P' } } = {}) {
  if (!t.timersEnabled) { t.mock.timers.enable({ apis: ['setTimeout'] }); t.timersEnabled = true; }
  const document = { activeElement: null, createElement: tag => new Node(document, tag) };
  const extra = new Map(), panels = suggestionNodes(Node, document, extra);
  const key = kind.slice(0, -1), parts = panels[key], input = new Node(document, 'input');
  input.value = '';
  // The form's fields: this one is `input`; the others hold the Match mode and the folder/project scope.
  const controls = { match: { value: mode }, folder: { value: '' }, project: { value: '' }, package: { value: '' }, [key]: input };
  const state = {
    set mode(value) { controls.match.value = value; },
    set scope(values) { for (const name of ['folder', 'project']) if (name !== key) controls[name].value = values[name]; },
  };
  state.scope = scope;
  const calls = [], chosen = [];
  const owner = mountSuggestions({ metadata, key, controls, panel: parts.panel, changed: () => chosen.push(input.value),
    api: { async get(resource, { params }) {
      calls.push({ resource, ...params });
      return get ? get(resource, params) : catalogPage(resource, params, all);
    } } });
  t.after(owner.dispose);
  const type = async value => { input.focus(); input.value = value; input.dispatchEvent(new Event('input')); t.mock.timers.tick(250); await settle(); };
  const key_ = async name => { const event = new Event('keydown', { cancelable: true }); event.key = name; input.dispatchEvent(event); await settle(); return event; };
  const options = () => parts.list.children.map(option => option.textContent);
  return { ...parts, input, calls, chosen, state, owner, type, key: key_, options };
}

test('typing opens the first five catalog names and Load more pages five at a time', async t => {
  const view = setup(t);
  await view.type('');
  assert.equal(view.panel.hidden, false);
  assert.equal(view.input.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(view.options(), names(5));
  assert.deepEqual(view.calls, [{ resource: 'folders', limit: 5, sort: 'name', direction: 'asc', folder: null, project: null, cursor: null }]);
  assert.equal(view.more.hidden, false);
  assert.equal(view.more.textContent, 'Load more');
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.deepEqual(view.options(), names(10));
  assert.equal(view.calls.at(-1).cursor, '5');
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.deepEqual(view.options(), names(12));
  assert.equal(view.more.hidden, true, 'Nothing more to load');
});

test('a typed term scans full pages and reveals already found matches without another request', async t => {
  const all = [...names(3), ...Array.from({ length: 8 }, (_, index) => `Sales ${index + 1}`)];
  const view = setup(t, { all });
  await view.type('sales');
  assert.deepEqual(view.calls.map(call => call.limit), [metadata.limits.max_limit]);
  assert.deepEqual(view.options(), ['Sales 1', 'Sales 2', 'Sales 3', 'Sales 4', 'Sales 5']);
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.calls.length, 1);
  assert.equal(view.options().length, 8);
  assert.equal(view.more.hidden, true);
  await view.type('none');
  assert.deepEqual(view.options(), []);
  assert.equal(view.status.textContent, 'No matching names.');
});

test('projects need the folder field and packages both fields; the scope goes to the request', async t => {
  const projects = setup(t, { kind: 'projects', scope: { folder: '', project: '' } });
  await projects.type('');
  assert.equal(projects.calls.length, 0);
  assert.equal(projects.status.textContent, 'Enter a folder first.');
  const packages = setup(t, { kind: 'packages', scope: { folder: 'Finance', project: '' } });
  await packages.type('');
  assert.equal(packages.calls.length, 0);
  assert.equal(packages.status.textContent, 'Enter a folder and a project first.');
  packages.state.scope = { folder: 'Finance', project: 'Load' };
  await packages.type('');
  assert.deepEqual([packages.calls[0].resource, packages.calls[0].folder, packages.calls[0].project], ['packages', 'Finance', 'Load']);
});

test('arrow keys move the active option, Enter chooses it and Escape closes the list', async t => {
  const view = setup(t);
  const down = await view.key('ArrowDown');
  assert.equal(down.defaultPrevented, true);
  assert.equal(view.panel.hidden, false, 'ArrowDown opens a closed list');
  await view.key('ArrowDown'); await view.key('ArrowDown');
  assert.equal(view.input.getAttribute('aria-activedescendant'), `${view.list.id}-1`);
  assert.deepEqual(view.list.children.map(option => option.getAttribute('aria-selected')), ['false', 'true', 'false', 'false', 'false']);
  await view.key('ArrowUp'); await view.key('ArrowUp');
  assert.equal(view.input.getAttribute('aria-activedescendant'), `${view.list.id}-4`, 'ArrowUp wraps to the last option');
  const enter = await view.key('Enter');
  assert.equal(enter.defaultPrevented, true, 'Choosing does not submit the form');
  assert.deepEqual(view.chosen, ['Name 05']);
  assert.equal(view.panel.hidden, true);
  assert.equal(view.input.getAttribute('aria-expanded'), 'false');
  assert.equal(view.input.getAttribute('aria-activedescendant'), null);
  const closedEnter = await view.key('Enter');
  assert.equal(closedEnter.defaultPrevented, false, 'Enter on a closed list submits as before');
  await view.type('Name');
  const escape = await view.key('Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(view.panel.hidden, true);
  assert.equal((await view.key('Escape')).defaultPrevented, false);
});

test('a click chooses an option; leaving the field closes the list', async t => {
  const view = setup(t);
  await view.type('');
  view.list.children[2].dispatchEvent(new Event('click'));
  assert.deepEqual(view.chosen, ['Name 03']);
  assert.equal(view.panel.hidden, true);
  view.input.dispatchEvent(new Event('pointerup')); await settle();
  assert.equal(view.panel.hidden, false, 'A pointer press opens the list');
  const inside = new Event('focusout'); inside.relatedTarget = view.more;
  view.input.dispatchEvent(inside);
  assert.equal(view.panel.hidden, false, 'Moving to Load more keeps it open');
  // focusout from Load more bubbles to the panel in a browser; the double dispatches it there.
  const outside = new Event('focusout'); outside.relatedTarget = null;
  view.panel.dispatchEvent(outside);
  assert.equal(view.panel.hidden, true);
});

test('LIKE mode offers no suggestions and sends no request', async t => {
  const view = setup(t, { mode: 'like' });
  for (const type of ['compositionstart', 'compositionend']) {
    view.input.focus();
    view.input.dispatchEvent(new Event(type));
    assert.equal(view.input.getAttribute('aria-expanded'), null, type);
  }
  await view.type('Fin');
  await view.key('ArrowDown');
  view.input.dispatchEvent(new Event('pointerup')); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(view.panel.hidden, true);
});

test('a first read shows Loading without Load more; a continuation keeps it in place, disabled', async t => {
  let release = null;
  const view = setup(t, { get: (resource, params) => new Promise(resolve => {
    release = () => resolve(catalogPage(resource, params, names(12)));
  }) });
  await view.type('');
  assert.equal(view.status.textContent, 'Loading…');
  assert.equal(view.more.hidden, true);
  release(); await settle();
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.more.hidden, false);
  assert.equal(view.more.getAttribute('aria-disabled'), 'true');
  assert.deepEqual(view.options(), names(5));
  release(); await settle();
  assert.equal(view.more.getAttribute('aria-disabled'), 'false');
  assert.deepEqual(view.options(), names(10));
});

test('errors offer Retry; late results after closing are not shown', async t => {
  let fail = true;
  const view = setup(t, { get: (resource, params) => {
    if (fail) throw new ApiError('http', { status: 503, code: 'database_unavailable' });
    return catalogPage(resource, params, names(2));
  } });
  await view.type('');
  assert.match(view.status.textContent, /unavailable|try again/i);
  assert.equal(view.more.textContent, 'Retry');
  assert.equal(view.more.hidden, false);
  fail = false;
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.deepEqual(view.options(), names(2));
  let release;
  const late = setup(t, { get: (resource, params) => new Promise(resolve => { release = () => resolve(catalogPage(resource, params, names(3))); }) });
  await late.type('');
  late.owner.hide();
  release(); await settle();
  assert.deepEqual(late.options(), []);
  assert.equal(late.panel.hidden, true);
});

test('a change of text forgets the highlighted name at once; leaving or Escape cancels a pending read', async t => {
  const view = setup(t, { all: ['Alpha', 'Beta'] });
  await view.type('');
  await view.key('ArrowDown');
  assert.equal(view.input.getAttribute('aria-activedescendant'), `${view.list.id}-0`);
  view.input.value = 'Beta';
  view.input.dispatchEvent(new Event('input'));
  assert.equal(view.input.getAttribute('aria-activedescendant'), null);
  assert.deepEqual(view.options(), []);
  const enter = await view.key('Enter');
  assert.equal(enter.defaultPrevented, false, 'Enter submits instead of choosing the old name');
  assert.deepEqual(view.chosen, []);
  view.owner.hide();
  const calls = view.calls.length;
  view.input.dispatchEvent(new Event('input'));
  const away = new Event('focusout'); away.relatedTarget = null;
  view.input.dispatchEvent(away);
  t.mock.timers.tick(250); await settle();
  view.input.dispatchEvent(new Event('input'));
  await view.key('Escape');
  t.mock.timers.tick(250); await settle();
  assert.equal(view.calls.length, calls, 'Neither a pending read after leaving nor after Escape runs');
  assert.equal(view.panel.hidden, true);
});

test('input method keys stay with the browser; a composition clears the list and its end reads only with focus', async t => {
  const view = setup(t);
  await view.type('');
  await view.key('ArrowDown');
  for (const changes of [{ isComposing: true }, { keyCode: 229 }]) {
    const enter = new Event('keydown', { cancelable: true });
    Object.assign(enter, { key: 'Enter', ...changes });
    view.input.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false, JSON.stringify(changes));
  }
  assert.deepEqual(view.chosen, []);
  view.input.dispatchEvent(new Event('input'));
  view.input.dispatchEvent(new Event('compositionstart'));
  assert.deepEqual(view.options(), [], 'Nothing listed before the composition can be chosen');
  const calls = view.calls.length;
  const composing = new Event('input'); composing.isComposing = true;
  view.input.dispatchEvent(composing);
  t.mock.timers.tick(250); await settle();
  assert.equal(view.calls.length, calls, 'Neither the earlier timer nor the composition reads');
  view.input.value = 'Name 1';
  view.input.ownerDocument.activeElement = null;
  view.input.dispatchEvent(new Event('compositionend'));
  t.mock.timers.tick(250); await settle();
  assert.equal(view.calls.length, calls, 'No read after the field lost focus');
  view.input.focus();
  view.input.dispatchEvent(new Event('compositionend'));
  t.mock.timers.tick(250); await settle();
  assert.equal(view.calls.length, calls + 1);
});

test('pressing Load more keeps focus in the field; choosing a name returns focus from a focused button', async t => {
  const view = setup(t);
  await view.type('');
  const press = new Event('pointerdown', { cancelable: true });
  view.more.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  view.more.focus();
  view.more.dispatchEvent(new Event('click')); await settle();
  view.list.children[7].dispatchEvent(new Event('click'));
  assert.deepEqual(view.chosen, ['Name 08']);
  assert.equal(view.input.ownerDocument.activeElement, view.input);
});

test('Search more shows at most five new names, even when a later page holds many matches', async t => {
  const all = [...names(200), ...Array.from({ length: 18 }, (_, index) => `Match ${String(index + 1).padStart(2, '0')}`)];
  const view = setup(t, { all });
  await view.type('match');
  assert.deepEqual(view.options(), []);
  assert.equal(view.more.textContent, 'Search more');
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.options().length, 5);
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.options().length, 10);
});

test('the focused Search more or Retry button stays during its read; focus returns to the field before it hides', async t => {
  const all = [...names(200), 'Match 1'];
  let release = null, fail = false;
  const view = setup(t, { all, get: (resource, params) => new Promise((resolve, reject) => {
    release = () => fail ? reject(new ApiError('http', { status: 503, code: 'database_unavailable' }))
      : resolve(catalogPage(resource, params, all));
  }) });
  await view.type('match'); release(); await settle();
  view.more.focus();
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.more.hidden, false, 'Kept while its read runs');
  assert.equal(view.more.getAttribute('aria-disabled'), 'true');
  release(); await settle();
  assert.deepEqual(view.options(), ['Match 1']);
  assert.equal(view.more.hidden, true);
  assert.equal(view.input.ownerDocument.activeElement, view.input);
  fail = true;
  await view.type('x'); release(); await settle();
  assert.equal(view.more.textContent, 'Retry');
  view.more.focus(); fail = false;
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.more.hidden, false);
  release(); await settle();
  // The scan found nothing in its first page: Search more remains, and keeps the focus.
  assert.deepEqual([view.more.hidden, view.more.textContent], [false, 'Search more']);
  assert.equal(view.input.ownerDocument.activeElement, view.more);
});

test('Escape on Load more closes the list and returns to the field', async t => {
  const view = setup(t);
  await view.type('');
  view.more.focus();
  const escape = new Event('keydown', { cancelable: true }); escape.key = 'Escape';
  view.panel.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(view.panel.hidden, true);
  assert.equal(view.input.ownerDocument.activeElement, view.input);
});

test('only Exact mode presents the field as a combobox', async t => {
  const view = setup(t);
  assert.deepEqual(['role', 'aria-autocomplete', 'aria-expanded'].map(name => view.input.getAttribute(name)),
    ['combobox', 'list', 'false']);
  view.state.mode = 'like'; view.owner.hide();
  assert.deepEqual(['role', 'aria-autocomplete', 'aria-expanded'].map(name => view.input.getAttribute(name)),
    [null, null, null]);
  view.state.mode = 'exact'; view.owner.hide();
  assert.equal(view.input.getAttribute('role'), 'combobox');
});

test('dispose removes every listener and cancels a pending read', async t => {
  const view = setup(t);
  view.input.focus();
  view.input.dispatchEvent(new Event('input'));
  view.owner.dispose();
  t.mock.timers.tick(250); await settle();
  view.input.dispatchEvent(new Event('pointerup'));
  await view.key('ArrowDown');
  view.more.dispatchEvent(new Event('click')); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(view.panel.hidden, true);
});

test('late input or composition events after leaving the field do not reopen the list', async t => {
  const view = setup(t);
  await view.type('');
  view.input.ownerDocument.activeElement = null;
  const away = new Event('focusout'); away.relatedTarget = null;
  view.input.dispatchEvent(away);
  const calls = view.calls.length;
  view.input.dispatchEvent(new Event('compositionend'));
  view.input.dispatchEvent(new Event('input'));
  t.mock.timers.tick(250); await settle();
  assert.equal(view.calls.length, calls);
  assert.equal(view.panel.hidden, true);
});

test('modified arrow keys and Enter stay with the browser, with the list open or closed', async t => {
  const view = setup(t);
  const press = async (key, changes) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, ...changes });
    view.input.dispatchEvent(event); await settle();
    return event.defaultPrevented;
  };
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(await press('ArrowUp', { [modifier]: true }), false, `${modifier} on a closed list`);
    assert.equal(view.panel.hidden, true);
  }
  await view.type('');
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(await press('ArrowDown', { [modifier]: true }), false, `${modifier} on an open list`);
    assert.equal(view.input.getAttribute('aria-activedescendant'), null);
  }
  await view.key('ArrowDown');
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(await press('Enter', { [modifier]: true }), false, `${modifier}+Enter`);
  }
  assert.deepEqual(view.chosen, []);
  assert.equal(view.input.getAttribute('aria-activedescendant'), `${view.list.id}-0`);
});

test('the field is announced as expanded only while the list has options', async t => {
  let release = null;
  const view = setup(t, { get: (resource, params) => new Promise(resolve => {
    release = names => resolve(catalogPage(resource, params, names));
  }) });
  await view.type('');
  assert.deepEqual([view.input.getAttribute('aria-expanded'), view.list.hidden], ['false', true], 'loading');
  release([]); await settle();
  assert.equal(view.status.textContent, 'No matching names.');
  assert.deepEqual([view.input.getAttribute('aria-expanded'), view.list.hidden], ['false', true], 'no matches');
  await view.type('N'); release(['Name']); await settle();
  assert.deepEqual([view.input.getAttribute('aria-expanded'), view.list.hidden], ['true', false], 'with options');
  // Typing or a composition clears the options at once, before the next read starts.
  for (const type of ['input', 'compositionstart']) {
    if (view.list.hidden) { await view.type('N'); release(['Name']); await settle(); }
    assert.equal(view.list.hidden, false);
    view.input.dispatchEvent(new Event(type));
    assert.deepEqual([view.options(), view.input.getAttribute('aria-expanded'), view.list.hidden], [[], 'false', true], type);
  }
  assert.equal(view.panel.hidden, true, 'A composition closes the list');
});
