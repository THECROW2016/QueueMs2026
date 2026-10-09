/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': api, '/socket.io': { target: api, ws: true } } },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup.ts'], css: false, include: ['tests/**/*.test.{ts,tsx}'] },
});
