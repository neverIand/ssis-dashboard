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
    name: 'browser-license-notices',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'LICENSES.txt',
        source: readFileSync(new URL('LICENSES.txt', import.meta.url), 'utf8'),
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
    // Only this dedicated generated directory is emptied by a build.
    outDir: fileURLToPath(new URL('../dashboard/static/app/', import.meta.url)),
    emptyOutDir: true,
    manifest: 'manifest.json',
  },
});
