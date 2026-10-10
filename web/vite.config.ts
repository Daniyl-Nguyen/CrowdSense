import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

// `npm run dev:lan` sets HTTPS=1 so phones on the LAN get a secure context (required for camera/mic).
const https = process.env.HTTPS === '1';
const api = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: {
    host: true,
    // WSL /mnt/* drives don't deliver file events; poll there so HMR works.
    watch: process.cwd().startsWith('/mnt/') ? { usePolling: true, interval: 300 } : undefined,
    port: 5173,
    proxy: {
      '/api': api,
      '/mediapipe': api,
      '/models': api,
      '/ort': api,
      '/ws': { target: api.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
