import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    outDir: 'dist-v2-fixture',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'v2-fixture.html'),
    },
  },
  plugins: [react()],
})
