import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works at any path (e.g. GitHub Pages project sites)
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
