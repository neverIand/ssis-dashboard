import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  input: fileURLToPath(new URL('src/main.js', import.meta.url)),
  // Keep generated imports relative to their asset, including under a URL prefix.
  base: './',
  publicDir: false,
  appType: 'mpa',
  plugins: [{
    name: 'packaged-static-files',
    generateBundle() {
      // A classic, render-blocking script: it must run before the stylesheet paints.
      this.emitFile({
        type: 'asset',
        fileName: 'theme-init.js',
        source: readFileSync(new URL('src/theme-init.js', import.meta.url), 'utf8'),
      });
      // Served from 'self' (CSP img-src), so the browser stops requesting a missing /favicon.ico.
      this.emitFile({
        type: 'asset',
        fileName: 'favicon.svg',
        source: readFileSync(new URL('src/favicon.svg', import.meta.url), 'utf8'),
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '^/api/v1(?:/|$)': 'http://127.0.0.1:5000',
    },
  },
  build: {
    // Baseline 2025: the last 2025 releases support every feature that was Baseline by the end of 2025.
    // The single entry needs no modulepreload polyfill, so the bundle ships no third-party code.
    target: ['chrome143', 'edge143', 'firefox146', 'safari26.2', 'ios26.2'],
    modulePreload: { polyfill: false },
    // Only this dedicated generated directory is emptied by a build.
    outDir: fileURLToPath(new URL('../dashboard/static/app/', import.meta.url)),
    emptyOutDir: true,
    manifest: 'manifest.json',
  },
});
