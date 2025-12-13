import { defineConfig } from 'vite';

export default defineConfig({
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  
  // Tauri expects a fixed port
  server: {
    port: 1420,
    strictPort: true,
  },
  
  // Build configuration
  build: {
    // Tauri supports es2021
    target: ['es2021', 'chrome100', 'safari13'],
    // Don't minify for debugging
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debugging
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
  
  // Environment variable prefix
  envPrefix: ['VITE_', 'TAURI_'],
});
