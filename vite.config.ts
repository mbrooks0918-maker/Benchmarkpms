import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
