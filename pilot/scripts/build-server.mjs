// Bundles the pilot server into one Node file with the esbuild that ships with Vite.
import { build } from 'esbuild';

await build({
  entryPoints: ['pilot/server/main.ts'],
  outfile: '.cache/pilot-server/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'warning',
  // CommonJS dependencies (pg, the Azure SDK) require Node built-ins; ESM output needs a require.
  banner: {
    js: "import { createRequire as __pilotCreateRequire } from 'node:module'; const require = __pilotCreateRequire(import.meta.url);",
  },
});
