import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser calls same-origin /api/v1; Vite forwards it to the FastAPI
// server (BREWSYNC_API_TARGET, default http://127.0.0.1:8000). VITE_API_URL overrides the
// base URL entirely for other deployments.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: env.BREWSYNC_API_TARGET || 'http://127.0.0.1:8000' },
      },
    },
  };
});
