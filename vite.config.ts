import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works at any path (e.g. GitHub Pages project sites)
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // Playwright specs live in tests/e2e and must not be picked up by Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
