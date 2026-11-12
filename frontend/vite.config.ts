import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const apiTarget = process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '8000'}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@data': fileURLToPath(new URL('../data', import.meta.url)) },
  },
  server: {
    port: 5173,
    // The API lives on :8000 in development; same-origin through this proxy keeps cookies simple.
    // changeOrigin stays false so the backend sees Host: localhost:5173 and builds the right OAuth redirect URI.
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    fs: { allow: [repoRoot] },
  },
  // maplibre-gl loads its worker via `new URL(..., import.meta.url)`; pre-bundling would break that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
