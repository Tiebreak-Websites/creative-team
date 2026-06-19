import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local-first: the dev server proxies /api to the FastAPI backend so the
// frontend uses same-origin relative URLs and needs no CORS config in dev.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Pin a single React instance so Vite's pre-bundled deps (Radix UI) don't
    // load a second copy — otherwise hooks throw "Invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.PLATFORM_API_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
