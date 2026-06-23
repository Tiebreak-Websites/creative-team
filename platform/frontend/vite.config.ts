import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Local-first: the dev server proxies /api to the FastAPI backend so the
// frontend uses same-origin relative URLs and needs no CORS config in dev.
// The proxy target resolves from (1) the PLATFORM_API_TARGET process env,
// then (2) the repo-root .env (gitignored), then (3) the 8000 default.
export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const env = loadEnv(mode, repoRoot, '')
  const apiTarget =
    process.env.PLATFORM_API_TARGET || env.PLATFORM_API_TARGET || 'http://127.0.0.1:8000'

  return {
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
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
