import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
// Saved PDFs must open before offline setup, so the viewer's worker belongs to the app shell.
// prepare-assets copies it here before every build.
const pdfWorker = 'public/runtime/pdf.worker.min.mjs';
const appShellRuntime = existsSync(pdfWorker)
  ? [
      {
        url: 'runtime/pdf.worker.min.mjs',
        revision: createHash('sha256').update(readFileSync(pdfWorker)).digest('hex'),
      },
    ]
  : [];
export default defineConfig({
  base: process.env.APP_BASE || '/',
  build:
    process.env.ACCEPTANCE_BUILD === '1'
      ? {
          outDir: '.cache/acceptance-dist',
          rollupOptions: { input: ['index.html', 'tests/harness.html'] },
        }
      : undefined,
  plugins: [
    react(),
    VitePWA({
      devOptions: { enabled: true, type: 'module' },
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'Campus Recall',
        short_name: 'Recall',
        description: 'Save campus information and find the original on this device.',
        start_url: './#/library',
        scope: './',
        display: 'standalone',
        background_color: '#f7f8fa',
        theme_color: '#245edb',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        globIgnores: ['runtime/**'],
        additionalManifestEntries: appShellRuntime,
        maximumFileSizeToCacheInBytes: 6_000_000,
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'dexie',
      'fflate',
      'tesseract.js',
      '@ffmpeg/ffmpeg',
      'pdfjs-dist',
      'onnxruntime-web/wasm',
      '@huggingface/transformers',
    ],
  },
  server: {
    hmr: process.env.ACCEPTANCE === '1' ? false : undefined,
    watch: process.env.ACCEPTANCE === '1' ? null : undefined,
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/acceptance/**'],
  },
});
