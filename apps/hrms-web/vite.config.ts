import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const pkg = (p: string) => path.resolve(__dirname, '../../packages', p, 'src/index.ts');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@yardhrms/ui': pkg('ui'),
      '@yardhrms/types': pkg('types'),
      '@yardhrms/authorization': pkg('authorization'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
  preview: { port: 5173, proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000' } } },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: { environment: 'jsdom', globals: true },
} as any);
