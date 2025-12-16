import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Default to node (faster, no DOM overhead)
    include: ['tests/**/*.test.ts', 'tests/**/*.test.js'], // Support both during migration
    // Override environment for specific test files that need DOM
    // Using happy-dom instead of jsdom for better ESM compatibility and performance
    environmentMatchGlobs: [
      ['**/VirtualScrollGrid.test.ts', 'happy-dom'],
      ['**/*.integration.test.ts', 'happy-dom'],
    ],
    // Setup files
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src-tauri/',
        'tests/',
        '*.config.js',
        '*.config.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@data': path.resolve(__dirname, './src/data'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@services': path.resolve(__dirname, './src/services'),
    },
  },
});
