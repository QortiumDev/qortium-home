import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const androidBuild = process.env.QORTIUM_HOME_ANDROID === '1'

export default defineConfig({
  base: './',
  root: androidBuild
    ? resolve(import.meta.dirname, 'src/home-v2-live/android')
    : undefined,
  build: {
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      input: androidBuild
        ? resolve(import.meta.dirname, 'src/home-v2-live/android/index.html')
        : {
            // Android has no widgets, so the widget page is desktop only.
            collectionsMigration: resolve(import.meta.dirname, 'collections-migration.html'),
            main: resolve(import.meta.dirname, 'v2-live.html'),
            widget: resolve(import.meta.dirname, 'widget.html'),
          },
    },
  },
  plugins: [react()],
})
