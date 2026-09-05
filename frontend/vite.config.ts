import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Stamp the build so a running instance can say which bundle it is. A stale
// deployed bundle previously presented as a blank screen with no way to tell
// it apart from a current one.
function appVersion(): string {
  try {
    return readFileSync(resolve(__dirname, '..', 'VERSION'), 'utf-8').trim()
  } catch {
    return '0.0.0'
  }
}

const BUILD_STAMP = `${appVersion()}+${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(BUILD_STAMP),
  },
  server: {
    port: 5173,
    host: true,
  }
})
