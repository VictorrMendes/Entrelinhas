import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production nginx serves the build and passes /api to the backend; in development Vite does the same.
// API_TARGET picks the backend (default: the one running locally).
export default defineConfig({
  plugins: [react()],
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
