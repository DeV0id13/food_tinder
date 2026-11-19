import {defineConfig} from 'vite';

const django = {target: 'http://127.0.0.1:8000', changeOrigin: false};

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': django,
      '/media': django,
    },
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
});
