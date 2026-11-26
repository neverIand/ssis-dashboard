import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preprocessCSS, resolveConfig } from 'vite';

// Parsed stylesheet lookups for tests. Lightning CSS prints the sheet for the supported browsers with nesting
// always flattened (Features.Nesting = 1), so selectors, media conditions and values each have one spelling:
// a lookup asks which value a selector gets, not how the rule is written, grouped, nested or ordered.
export const stylesheetPath = fileURLToPath(new URL('../src/styles.css', import.meta.url));
const targets = { chrome: 143 << 16, firefox: 146 << 16, safari: (26 << 16) | (2 << 8) };
let config;
async function print(code) {
  config ??= await resolveConfig({ configFile: false, css: { transformer: 'lightningcss', lightningcss: { targets, include: 1 } } },
    'serve');
  return (await preprocessCSS(code, stylesheetPath, config)).code;
}

// Index just past a quoted string or bracketed group that starts at `index`.
function skip(text, index) {
  const open = text[index];
  if (open === '"' || open === "'") {
    for (index += 1; index < text.length && text[index] !== open; index += 1) if (text[index] === '\\') index += 1;
    return index + 1;
  }
  const close = { '(': ')', '[': ']' }[open];
  for (index += 1; index < text.length && text[index] !== close;) index = '"\'(['.includes(text[index]) ? skip(text, index) : index + 1;
  return index + 1;
}

// Split at a separator outside strings and brackets.
function split(text, separator) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length;) {
    if ('"\'(['.includes(text[index])) index = skip(text, index);
    else if (text[index] === separator) { parts.push(text.slice(start, index).trim()); start = index += 1; }
    else index += 1;
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Selector specificity [ids, classes/attributes/pseudo-classes, types/pseudo-elements]. :is(), :not() and :has()
// count their most specific argument and :where() nothing (Selectors Level 4).
export function specificity(selector) {
  const total = [0, 0, 0], add = value => value.forEach((count, index) => { total[index] += count; });
  const highest = list => split(list, ',').map(specificity)
    .reduce((best, value) => compareSpecificity(value, best) > 0 ? value : best, [0, 0, 0]);
  for (let index = 0; index < selector.length;) {
    const character = selector[index];
    if (character === '[') { total[1] += 1; index = skip(selector, index); }
    else if (character === '#' || character === '.') {
      total[character === '#' ? 0 : 1] += 1;
      index += 1;
      while (index < selector.length && /[\w-]/.test(selector[index])) index += 1;
    } else if (character === ':') {
      const element = selector[index + 1] === ':';
      const name = selector.slice(index + (element ? 2 : 1)).match(/^[\w-]+/)[0];
      index += (element ? 2 : 1) + name.length;
      let argument = null;
      if (selector[index] === '(') { const end = skip(selector, index); argument = selector.slice(index + 1, end - 1); index = end; }
      if (element) total[2] += 1;
      else if (['is', 'not', 'has'].includes(name)) add(highest(argument));
      else if (name !== 'where') {
        total[1] += 1;
        // :nth-child(An+B of S) and :nth-last-child() also count their selector list.
        const of = /^nth(-last)?-child$/.test(name) ? argument.match(/\sof\s(.+)$/) : null;
        if (of) add(highest(of[1]));
      }
    } else if (/[\w-]/.test(character)) {
      total[2] += 1;
      while (index < selector.length && /[\w-]/.test(selector[index])) index += 1;
    } else index += 1;
  }
  return total;
}

// `a:is(b, c) d` also answers to `ab d` and `ac d`; the rule keeps the specificity of the original selector.
function expandIs(selector) {
  const start = selector.indexOf(':is(');
  if (start < 0) return [selector];
  const end = skip(selector, start + 3);
  const rest = expandIs(selector.slice(end));
  return split(selector.slice(start + 4, end - 1), ',').flatMap(expandIs).flatMap(branch =>
    rest.map(tail => `${selector.slice(0, start)}${branch}${tail}`));
}

// Comments go; strings that merely contain comment markers stay.
function withoutComments(code) {
  let out = '';
  for (let index = 0; index < code.length;) {
    if (code[index] === '"' || code[index] === "'") {
      const end = skip(code, index);
      out += code.slice(index, end);
      index = end;
    } else if (code.startsWith('/*', index)) {
      const end = code.indexOf('*/', index + 2);
      index = end < 0 ? code.length : end + 2;
      out += ' ';
    } else out += code[index++];
  }
  return out;
}

// Rules in source order: { context: [at-rule preludes], media, selectors: [{ text, aliases, specificity }], declarations }.
// Only @media and @keyframes blocks are modelled; any statement at-rule (@layer x;, @import) or other block
// at-rule (@layer, @supports, @container) throws, as it would change the cascade the lookups assume.
function parse(code) {
  const rules = [], context = [];
  let index = 0, start = 0;
  code = withoutComments(code);
  while (index < code.length) {
    const character = code[index];
    if ('"\'(['.includes(character)) { index = skip(code, index); continue; }
    if (character === ';') throw new Error(`Unsupported statement: ${code.slice(start, index + 1).trim()}`);
    if (character === '}') { context.pop(); start = index += 1; continue; }
    if (character !== '{') { index += 1; continue; }
    const prelude = code.slice(start, index).trim();
    if (prelude.startsWith('@')) {
      if (!/^@(media|keyframes)\s/.test(prelude)) throw new Error(`Unsupported at-rule: ${prelude}`);
      context.push(prelude);
      start = index += 1;
      continue;
    }
    let end = index + 1;
    while (code[end] !== '}') end = '"\'(['.includes(code[end]) ? skip(code, end) : end + 1;
    const declarations = split(code.slice(index + 1, end), ';').map(item => {
      const colon = item.indexOf(':'), value = item.slice(colon + 1).trim();
      return { property: item.slice(0, colon).trim(), value, important: /!important$/.test(value) };
    });
    const selectors = split(prelude, ',').map(text => ({ text, branches: expandIs(text),
      aliases: new Set([text, ...expandIs(text)]), specificity: specificity(text) }));
    rules.push({ context: [...context], media: context.join(' '), selectors, declarations });
    start = index = end + 1;
  }
  return rules;
}

// Whether an at-rule context holds for a viewport width in CSS pixels (optional) and a set of enabled feature
// conditions such as `(forced-colors: active)`, each condition of each @media judged on its own. A media-query
// rem is the browser's initial font size: 16 px by default, which the tests assume. A width condition without a
// width, or a feature condition that is not enabled, does not hold. Syntax this evaluator does not understand
// throws instead of being skipped.
function holds(context, width, features) {
  const px = text => {
    const match = text.match(/^([\d.]+)(rem|px)$/);
    if (!match) throw new Error(`Unsupported length: ${text}`);
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
  };
  const compare = (left, operator, right) => ({ '<': left < right, '<=': left <= right, '>': left > right, '>=': left >= right })[operator];
  return context.every(prelude => {
    if (!prelude.startsWith('@media ')) throw new Error(`Unsupported at-rule in a width lookup: ${prelude}`);
    const query = prelude.slice(7);
    if (/(^|\s)(not|or|only)\s|,/.test(query)) throw new Error(`Unsupported media query: ${prelude}`);
    return query.split(/\s+and\s+/).every(part => {
      const condition = part.match(/^\((.*)\)$/)?.[1];
      if (condition === undefined) throw new Error(`Unsupported media query: ${prelude}`);
      if (!/\bwidth\b/.test(condition)) return features.has(part);
      if (width === undefined) return false;
      const terms = condition.split(/\s*(<=|>=|<|>)\s*/);
      if (terms.length === 3 && terms[0] === 'width') return compare(width, terms[1], px(terms[2]));
      if (terms.length === 3 && terms[2] === 'width') return compare(px(terms[0]), terms[1], width);
      if (terms.length === 5 && terms[2] === 'width') return compare(px(terms[0]), terms[1], width) && compare(width, terms[3], px(terms[4]));
      throw new Error(`Unsupported width condition: ${condition}`);
    });
  });
}

// Shorthands that compete in a longhand's cascade, with the part of their value that the longhand takes.
const shorthands = {
  'overflow-x': [['overflow', value => value.split(/\s+/)[0]]],
  'overflow-y': [['overflow', value => value.split(/\s+/).at(-1)]],
  'background-color': [['background', value => value]],
  background: [['background-color', value => value]],
  'border-left-width': [['border-left', value => value.split(/\s+/).find(part => /^[\d.]+[a-z]*$|^(thin|medium|thick)$/.test(part)) ?? 'medium'],
    ['border-width', value => value.split(/\s+/).at({ 1: 0, 2: 1, 3: 1, 4: 3 }[value.split(/\s+/).length])],
    ['border', value => value.split(/\s+/).find(part => /^[\d.]+[a-z]*$|^(thin|medium|thick)$/.test(part)) ?? 'medium']],
  'border-left-style': [['border-left', value => value.split(/\s+/).find(part => /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(part)) ?? 'none'],
    ['border-style', value => value.split(/\s+/).at({ 1: 0, 2: 1, 3: 1, 4: 3 }[value.split(/\s+/).length])],
    ['border', value => value.split(/\s+/).find(part => /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(part)) ?? 'none']],
};

// Cascade order between two declarations for the same element: importance, then specificity, then source order.
const wins = (a, b) => a.important !== b.important ? a.important
  : compareSpecificity(a.specificity, b.specificity) ? compareSpecificity(a.specificity, b.specificity) > 0 : a.order > b.order;

export async function stylesheet(source = readFileSync(stylesheetPath, 'utf8')) {
  const rules = parse(await print(source)).filter(rule => !rule.context.some(prelude => prelude.startsWith('@keyframes')));
  const selector = async text => parse(await print(`${text} { --probe: 0 }`))[0].selectors[0].text;
  const media = async text => parse(await print(`@media ${text} { x { --probe: 0 } }`))[0].media;
  const value = async (property, text) => parse(await print(`x { ${property}: ${text} }`))[0].declarations[0].value;
  // Rules in scope: the top level always; with `width`, also the media rules that hold at that viewport width;
  // with `media`, also the rules under that feature condition (forced colours, for example). Both may be given.
  async function scoped(options = {}) {
    // `media` names one enabled feature condition; its printed form ("@media (…)") gives the condition text.
    const features = new Set(options.media === undefined ? [] : [(await media(options.media)).slice(7)]);
    return rules.filter(rule => holds(rule.context, options.width, features));
  }
  return {
    rules,
    // The cascade winner among the rules in scope that list this selector (or have it as an :is() branch):
    // !important first, then the listed selector's specificity, then source order. Undefined if none sets it.
    // An array names several selectors that all match one element, such as a base class and its variant.
    // Shorthands compete too (overflow for overflow-x, background and background-color for each other).
    async get(text, property, options) {
      const wanted = await Promise.all([text].flat().map(selector));
      const names = new Map([[property, value => value], ...(shorthands[property] ?? [])]);
      let best;
      for (const rule of await scoped(options)) {
        const position = rules.indexOf(rule);
        for (const item of rule.selectors.filter(entry => wanted.some(name => entry.aliases.has(name)))) {
          for (const [index, declaration] of rule.declarations.entries()) {
            if (!names.has(declaration.property)) continue;
            const part = names.get(declaration.property)(declaration.value.replace(/\s*!important$/, ''));
            // Source order is the rule's position, then the declaration's position inside it.
            const candidate = { ...declaration, value: declaration.important ? `${part} !important` : part,
              specificity: item.specificity, order: position + index / (rule.declarations.length + 1) };
            if (!best || wins(candidate, best)) best = candidate;
          }
        }
      }
      return best?.value;
    },
    // The value the stylesheet would print for this property and text, for comparing with get().
    value,
    // Every selector that sets the property (any value, or one the predicate accepts), with its media condition.
    setting(property, predicate = () => true) {
      return rules.flatMap(rule => rule.declarations.filter(entry => entry.property === property && predicate(entry.value))
        .flatMap(() => rule.selectors.map(item => ({ selector: item.text, branches: item.branches, media: rule.media }))));
    },
  };
}

// One parsed copy of styles.css for all tests in a file.
let shared;
export const loadStylesheet = () => shared ??= stylesheet();

// assert helper: the selector gets exactly this value (both printed the same way).
export async function expectStyle(assert, sheet, selector, property, expected, options) {
  assert.equal(await sheet.get(selector, property, options), await sheet.value(property, expected),
    `${selector} { ${property} }${options ? ` ${JSON.stringify(options)}` : ''}`);
}
