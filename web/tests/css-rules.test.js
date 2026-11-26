import assert from 'node:assert/strict';
import test from 'node:test';
import { specificity, stylesheet } from './css-rules.js';

// The helper the stylesheet tests rely on: cascade order, parsing edge cases and media evaluation.
test('specificity counts :is/:not/:has by their strongest argument and :where as nothing', () => {
  assert.deepEqual(specificity('.a'), [0, 1, 0]);
  assert.deepEqual(specificity('#x .a > td::before'), [1, 1, 2]);
  assert.deepEqual(specificity(':is(.a, #b)[data-x="1"]'), [1, 1, 0]);
  assert.deepEqual(specificity('tr:not(.a, .b .c) td'), [0, 2, 2]);
  assert.deepEqual(specificity(':where(#x) a'), [0, 0, 1]);
  assert.deepEqual(specificity('col:nth-child(2)'), [0, 1, 1]);
  assert.deepEqual(specificity(':nth-child(1 of #a, .b)'), [1, 1, 0]);
  assert.deepEqual(specificity(':is(.x, :is(#y, .z))'), [1, 0, 0]);
});

test('get() picks the cascade winner: importance, then specificity, then source order', async () => {
  const sheet = await stylesheet(`.a { color: red !important } .a { color: blue }
    .b.c, .b { width: 1px } .b { width: 2px } :is(.b, #id) { width: 3px }
    @media (width >= 40rem) { .d { order: 1 } } .d { order: 2 }
    :is(.e, :nth-child(1 of #f)) { order: 1 } .e { order: 2 } :is(.g, :is(.h, #i)) { order: 1 } .h { order: 2 }`);
  assert.equal(await sheet.get('.a', 'color'), 'red !important');
  assert.equal(await sheet.get('.b', 'width'), '3px', 'the :is() rule has #id specificity');
  assert.equal(await sheet.get('.b.c', 'width'), '1px');
  assert.equal(await sheet.get(':is(.b, #id)', 'width'), '3px', 'a selector with :is() is found as written');
  assert.equal(await sheet.get('.d', 'order', { width: 800 }), '2', 'a later top-level rule wins');
  assert.equal(await sheet.get('.d', 'order', { width: 400 }), '2');
  assert.equal(await sheet.get('.e', 'order'), '1', 'an :nth-child(of #id) argument counts');
  assert.equal(await sheet.get('.h', 'order'), '1', 'a nested :is() branch is found, with its #id specificity');
  assert.equal(await sheet.get(['.type', '.type[data-x="1"]'], 'order'), undefined);
  // Inside one rule the later declaration wins, also across a shorthand and its longhand.
  const inner = await stylesheet('.k { background: red; background-color: blue } .m { overflow: auto; overflow-x: clip }');
  assert.equal(await inner.get('.k', 'background'), await inner.value('background-color', 'blue'));
  assert.equal(await inner.get('.m', 'overflow-x'), 'clip');
  assert.equal(await inner.get('.m', 'overflow-y'), 'auto');
});

test('parsing survives braces in strings; range and nested media evaluate; unknown syntax throws', async () => {
  const sheet = await stylesheet(`.q::before { content: "}" } .r { color: red }
    @media (550px < width < 650px) { .s { order: 1 } }
    @media (width >= 30rem) { @media (width < 50rem) { .t { order: 1 } } }
    @media (forced-colors: active) { .u { order: 1 } }`);
  assert.equal(await sheet.get('.r', 'color'), 'red');
  assert.equal(await sheet.get('.s', 'order', { width: 600 }), '1');
  assert.equal(await sheet.get('.s', 'order', { width: 700 }), undefined);
  assert.equal(await sheet.get('.t', 'order', { width: 600 }), '1');
  assert.equal(await sheet.get('.t', 'order', { width: 900 }), undefined);
  assert.equal(await sheet.get('.u', 'order', { width: 600 }), undefined, 'feature conditions are not assumed');
  assert.equal(await sheet.get('.u', 'order', { media: '(forced-colors: active)' }), '1');
  // A feature and a width in one query: both must hold.
  const both = await stylesheet('@media (forced-colors: active) and (width <= 31.3333rem) { .y { order: 1 } }');
  assert.equal(await both.get('.y', 'order', { media: '(forced-colors: active)', width: 420 }), '1');
  assert.equal(await both.get('.y', 'order', { media: '(forced-colors: active)', width: 1400 }), undefined);
  assert.equal(await both.get('.y', 'order', { width: 420 }), undefined);
  assert.equal(await both.get('.y', 'order', { media: '(forced-colors: active)' }), undefined);
  const unknown = await stylesheet('@media (orientation: portrait), (width > 10px) { .v { order: 1 } }');
  await assert.rejects(unknown.get('.v', 'order', { width: 600 }), /Unsupported/);
  // Cascade-changing at-rules are rejected, not dropped; a comment marker inside a string is text.
  await assert.rejects(stylesheet('@layer demo; .x { color: red }'), /Unsupported/);
  await assert.rejects(stylesheet('@supports (display: grid) { .x { color: red } }'), /Unsupported/);
  const quoted = await stylesheet('.w::before { content: "/* test */" }');
  assert.equal(await quoted.get('.w::before', 'content'), '"/* test */"');
});
