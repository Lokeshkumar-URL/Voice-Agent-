import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/auth': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/admin': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/users': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/agents': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/credits': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/dashboard': { target: 'http://127.0.0.1:1112', changeOrigin: true },
        '/api': { target: 'http://127.0.0.1:1112', changeOrigin: true },
      },
    },
  };
});
