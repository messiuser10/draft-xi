import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
