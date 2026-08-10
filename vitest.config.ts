import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/client'),
    },
  },
  test: {
    root: resolve(import.meta.dirname),
    include: ['src/server/**/*.test.ts'],
  },
})
