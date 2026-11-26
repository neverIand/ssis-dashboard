import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStylesheet } from './css-rules.js';

const sheet = await loadStylesheet();
// The properties one selector gets at the top level, as the stylesheet prints them.
const rule = selector => Object.fromEntries(sheet.rules
  .filter(item => item.media === '' && item.selectors.some(entry => entry.text === selector))
  .flatMap(item => item.declarations.map(declaration => [declaration.property, declaration.value])));
// Each colour token is light-dark(light, dark): split the root block into the two themes.
const theme = index => Object.fromEntries(Object.entries(rule(':root')).map(([name, value]) =>
  [name, value.match(/^light-dark\(([^,]+), ([^,]+)\)$/)?.[index + 1] ?? value]));
const themes = [theme(0), theme(1)];
const luminance = hex => {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const channels = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
};
const contrast = (foreground, background) => {
  const [a, b] = [foreground, background].map(luminance);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('all six type chip families have at least 4.5:1 text contrast in both themes', async t => {
  let minimum = Infinity;
  for (const [theme, width] of themes.flatMap(item => [[item, undefined], [item, 420]])) {
    const resolve = value => theme[value.match(/^var\((--[\w-]+)\)$/)[1]];
    for (const family of ['text', 'integer', 'decimal', 'boolean', 'datetime', 'other']) {
      // The cascade winner over the base and the family rule, as a chip element matches both (background and
      // background-color compete in the helper).
      const selectors = ['.type-chip', `.type-chip[data-family="${family}"]`];
      const options = width === undefined ? undefined : { width };
      const style = { color: await sheet.get(selectors, 'color', options), background: await sheet.get(selectors, 'background', options) };
      const ratio = contrast(resolve(style.color), resolve(style.background));
      assert.ok(ratio >= 4.5, `${family}: ${ratio.toFixed(2)}:1`);
      minimum = Math.min(minimum, ratio);
    }
    const backgrounds = ['project', 'package', 'system'].map(scope => theme[`--sd-scope-${scope}`]);
    assert.equal(new Set([...backgrounds, theme['--sd-subtle']]).size, 4);
    for (const background of backgrounds) assert.ok(contrast(theme['--sd-secondary'], background) >= 4.5);
  }
  t.diagnostic(`12 chip/theme pairs; minimum text contrast ${minimum.toFixed(2)}:1.`);
});
