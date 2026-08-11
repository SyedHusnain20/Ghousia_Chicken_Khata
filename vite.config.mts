import { defineConfig } from 'vite';
import path from 'path';

const rootDir = import.meta.dirname;

// Renderer lives at src/renderer and builds to dist/renderer, matching what
// src/main/index.ts loads in production (dist/renderer/index.html) and what
// it points at in dev (the Vite dev server, see package.json's dev script).
export default defineConfig({
  root: path.resolve(rootDir, 'src/renderer'),
  base: './', // relative asset paths - required for file:// loading in the packaged app
  build: {
    outDir: path.resolve(rootDir, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});