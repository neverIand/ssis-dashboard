import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const declarations = block => Object.fromEntries([...block.matchAll(/([\w-]+):\s*([^;]+);/g)]
  .map(([, name, value]) => [name, value.trim()]));
const rule = selector => declarations(css.slice(css.indexOf(selector)).match(/\{([^}]+)\}/)[1]);
const themes = [rule(':root {'), rule(':root[data-theme="dark"]')];
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

test('all six type chip families have at least 4.5:1 text contrast in both themes', t => {
  let minimum = Infinity;
  for (const theme of themes) {
    const resolve = value => theme[value.match(/^var\((--[\w-]+)\)$/)[1]];
    for (const family of ['text', 'integer', 'decimal', 'boolean', 'datetime', 'other']) {
      const style = { ...rule('.type-chip {'), ...family === 'other' ? {} : rule(`.type-chip[data-family="${family}"]`) };
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
