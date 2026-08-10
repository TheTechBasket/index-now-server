import { resolve } from 'node:path'
import viteFastify from '@fastify/vite/plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  plugins: [react(), tailwindcss(), viteFastify({ spa: true })],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src/client') },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
})
