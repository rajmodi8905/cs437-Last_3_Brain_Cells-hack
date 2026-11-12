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
      : process.env.ENGINE_HOST_BUILD === '1'
        ? {
            // The pilot's engine host page (docs/pilot/whatsapp.md) runs the same engine code but
            // is built apart from the app, so the published app build stays unchanged.
            outDir: '.cache/engine-host-dist',
            rollupOptions: { input: ['pilot/engine-host/index.html'] },
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
        name: 'AnyRecall',
        short_name: 'AnyRecall',
        description: 'Save campus information and find the original on this device.',
        start_url: './#/library',
        scope: './',
        display: 'standalone',
        // The paper colour, matching index.html's theme-color, for the status bar and splash.
        background_color: '#f4f1ea',
        theme_color: '#f4f1ea',
        // Installed Android Chrome lists the app in the share sheet. src/sw.ts answers the POST on
        // the device and opens Add; the types match Add's file picker.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: [
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'application/pdf',
                  'audio/mpeg',
                  'audio/wav',
                  'audio/mp4',
                  'video/mp4',
                  '.jpg',
                  '.jpeg',
                  '.png',
                  '.webp',
                  '.pdf',
                  '.mp3',
                  '.wav',
                  '.m4a',
                  '.mp4',
                ],
              },
            ],
          },
        },
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
