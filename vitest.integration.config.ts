import { defineConfig } from 'vitest/config'
import { alias } from './electron.vite.config'
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Live fixtures share one database and change its catalog/permissions.
    // Keep files serial; individual tests still exercise concurrent DB sessions.
    fileParallelism: false,
    testTimeout: 30000,
  },
})
