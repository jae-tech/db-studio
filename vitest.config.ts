import { defineConfig } from 'vitest/config'
import { alias } from './electron.vite.config'
export default defineConfig({
  resolve: { alias },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
