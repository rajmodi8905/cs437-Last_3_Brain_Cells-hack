/// <reference types="node" />
// Local pilot server: the built PWA and the API on one origin. Run with `npm run pilot:server`.
import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createPilotHandler } from './app';
import { loadConfig } from './config';
import { MemoryObjectStore, MemoryPilotStore } from './memory';
import { createStaticHandler } from './static';
import { googleKeySource, staticKeySource } from './tokens';

const config = loadConfig(process.env);
const devKey = config.devKeyFile ? createPrivateKey(readFileSync(config.devKeyFile)) : undefined;

/** Signs a Firebase-shaped token, so local sign-in takes the same path as Google's. */
const devSigner = devKey
  ? (email: string) => {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const header = part({ alg: 'RS256', kid: 'dev-key', typ: 'JWT' });
      const payload = part({
        iss: `https://securetoken.google.com/${config.projectId}`,
        aud: config.projectId,
        sub: `dev-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24)}`,
        iat: now,
        exp: now + 3600,
        email,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      });
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${payload}`);
      return `${header}.${payload}.${signer.sign(devKey).toString('base64url')}`;
    }
  : undefined;

const api = createPilotHandler({
  projectId: config.projectId,
  allowedEmailDomain: config.allowedEmailDomain,
  origin: config.origin,
  keys: devKey ? staticKeySource({ 'dev-key': createPublicKey(devKey) }) : googleKeySource(),
  store: new MemoryPilotStore(),
  objects: new MemoryObjectStore(),
  quotaBytes: config.quotaBytes,
  devSigner,
  firebaseWeb: config.firebaseWeb,
});
createServer(createStaticHandler(config.staticDir, api)).listen(config.port, config.host, () => {
  console.log(`Pilot server on ${config.origin} (listening on ${config.host}:${config.port}).`);
  console.log('Storage is in memory only: everything is lost when the server stops.');
  if (devKey) console.log('Development sign-in is on: any typed IITGN email can sign in.');
});
