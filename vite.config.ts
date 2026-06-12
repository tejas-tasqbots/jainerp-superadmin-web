import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxies /api → superadmin-api so the client can use relative URLs
// (same-origin in prod behind the gateway).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3105',
        changeOrigin: true,
      },
    },
  },
});
