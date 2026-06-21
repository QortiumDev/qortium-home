import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  plugins: [react()],
});
