import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        globals: resolve(import.meta.dirname, 'src/client/globals.css'),
      },
      output: {
        assetFileNames: '[name][extname]',
      },
    },
  },
})
