import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Allow configuring the proxy target via environment so the dev server inside
// Docker can proxy to the backend container hostname (e.g. http://app:3000)
const proxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy requests under /v1 to the backend (no path rewrite)
      '/v1': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
      },
      // Proxy uploads/static paths
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
      },
      // Websocket path for socket.io
      '/socket': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true
      }
    },
  },
});
