import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The SPA entry is app.html (served for /login, /dashboard, /project/:id,
      // /s/:token, /v/:token, …). The marketing landing is a static
      // public/index.html served at "/".
      input: fileURLToPath(new URL('./app.html', import.meta.url)),
    },
  },
  define: {
    // Auto build stamp — resolved at build time. On Vercel,
    // VERCEL_GIT_COMMIT_SHA is the deployed commit; locally it's absent so we
    // fall back to 'dev'. Build date is captured whenever the bundle is built.
    __BUILD_SHA__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7),
    ),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
})
