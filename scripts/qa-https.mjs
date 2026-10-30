// Local production preview only. The user supplies a certificate trusted by the test device.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { preview } from 'vite';
if (!process.env.QA_TLS_KEY || !process.env.QA_TLS_CERT)
  throw Error(
    'Set QA_TLS_KEY and QA_TLS_CERT to existing local certificate files. This command does not issue certificates, change device trust or deploy a public site. See docs/implementation/nakshatra-quickstart.md.',
  );
const port = Number(process.env.QA_PORT ?? 4173);
const host = process.env.QA_HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid QA_PORT.');
const app = await preview({
  build: { outDir: process.env.QA_OUT_DIR || 'dist' },
  preview: { host: '127.0.0.1', port: 0, strictPort: true, https: undefined },
});
await new Promise((resolve, reject) =>
  app.httpServer.close((error) => (error ? reject(error) : resolve())),
);
// HTTP/1.1 avoids the observed local HTTP/2 preview failure on the reference iPhone.
const server = createServer(
  {
    key: await readFile(process.env.QA_TLS_KEY),
    cert: await readFile(process.env.QA_TLS_CERT),
    ALPNProtocols: ['http/1.1'],
  },
  app.middlewares,
);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, resolve);
});
console.log(
  `QA_HTTPS_URL=https://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`,
);
console.log(
  'Production preview. On a phone use the certificate hostname/LAN address, with trust configured on that phone. Stop with Ctrl+C.',
);
