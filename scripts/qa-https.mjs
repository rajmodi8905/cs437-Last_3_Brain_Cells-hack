// Local production preview only. The user supplies a certificate trusted by the test device.
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';
if (!process.env.QA_TLS_KEY || !process.env.QA_TLS_CERT)
  throw Error(
    'Set QA_TLS_KEY and QA_TLS_CERT to existing local certificate files. This command does not issue certificates, change device trust or deploy a public site. See docs/implementation/nakshatra-quickstart.md.',
  );
const port = Number(process.env.QA_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid QA_PORT.');
const server = await preview({
  preview: {
    host: process.env.QA_HOST || '127.0.0.1',
    port,
    strictPort: true,
    https: {
      key: await readFile(process.env.QA_TLS_KEY),
      cert: await readFile(process.env.QA_TLS_CERT),
    },
  },
});
server.printUrls();
console.log(
  'Production preview. On a phone use the certificate hostname/LAN address, with trust configured on that phone. Stop with Ctrl+C.',
);
