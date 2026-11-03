import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// Shared with both Vitest configs; keep in sync with tsconfig "paths".
export const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@': resolve('src/renderer/src'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-stdio': resolve('src/main/mcp-stdio.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    resolve: { alias },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [react(), tailwindcss()],
  },
})
