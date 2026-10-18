import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The production build is served by the backend (WEB_DIR), on the same origin as the API.
export default defineConfig({
  plugins: [react()],
});
