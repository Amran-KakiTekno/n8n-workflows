import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The demo is a fully client-side single page: no proxy, no external data
// source, no server-side rendering. The build output is a static `dist/` folder.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4104,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4104,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
