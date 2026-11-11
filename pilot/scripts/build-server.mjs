// Bundles the pilot server into one Node file with the esbuild that ships with Vite.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'pilot/server/main.ts', backup: 'pilot/server/backup-cli.ts' },
  outdir: '.cache/pilot-server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'warning',
  // The WhatsApp engine host loads Playwright only when the channel is on; it stays a package
  // next to the bundle (node_modules here, /app/node_modules in the image), not part of it.
  external: ['@playwright/test', 'playwright', 'playwright-core'],
  // CommonJS dependencies (pg, the Azure SDK) require Node built-ins; ESM output needs a require.
  banner: {
    js: "import { createRequire as __pilotCreateRequire } from 'node:module'; const require = __pilotCreateRequire(import.meta.url);",
  },
});
