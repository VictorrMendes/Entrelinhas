import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Writes dist/sw.js from sw.js with every built file to store, and a cache name that changes when any of them does. */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    writeBundle({ dir = 'dist' }) {
      const urls = readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile() && f.name !== 'sw.js')
        .map((f) => `/${relative(dir, join(f.parentPath, f.name)).replaceAll('\\', '/')}`)
        .sort();
      const hash = createHash('sha256');
      for (const url of urls) hash.update(url).update(readFileSync(join(dir, url)));
      const sw = readFileSync('sw.js', 'utf8')
        .replace('__CACHE__', JSON.stringify(`entrelinhas-${hash.digest('hex').slice(0, 12)}`))
        .replace('__FILES__', JSON.stringify(urls));
      writeFileSync(join(dir, 'sw.js'), sw);
    },
  };
}

// In production nginx serves the build and passes /api to the backend; in development Vite does the same.
// API_TARGET picks the backend (default: the one running locally).
export default defineConfig({
  plugins: [react(), serviceWorker()],
  // shown in Ajustes > Sobre: the day the app was built
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
