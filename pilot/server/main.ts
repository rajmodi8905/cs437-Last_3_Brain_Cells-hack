/// <reference types="node" />
// Local pilot server: the built PWA and the API on one origin. Run with `npm run pilot:server`.
import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cleanUpPilot, createPilotHandler } from './app';
import { loadConfig } from './config';
import { AzureBlobObjectStore, managedIdentityCredential } from './blob';
import { MemoryObjectStore, MemoryPilotStore } from './memory';
import { PostgresPilotStore } from './postgres';
import { createStaticHandler } from './static';
import { googleKeySource, staticKeySource } from './tokens';

const config = loadConfig(process.env);
const devKey = config.devKeyFile ? createPrivateKey(readFileSync(config.devKeyFile)) : undefined;

/** Signs a Google-shaped ID token, so local sign-in goes through the same identity checks. */
const devSigner = devKey
  ? (email: string) => {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const header = part({ alg: 'RS256', kid: 'dev-key', typ: 'JWT' });
      const payload = part({
        iss: 'https://accounts.google.com',
        aud: config.clientId,
        sub: `dev-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24)}`,
        iat: now,
        exp: now + 3600,
        email,
        email_verified: true,
        // Like Google, only Workspace accounts carry a hosted domain: here, the email's own.
        hd: email.slice(email.lastIndexOf('@') + 1).toLowerCase(),
      });
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${payload}`);
      return `${header}.${payload}.${signer.sign(devKey).toString('base64url')}`;
    }
  : undefined;

const { storage } = config;
const store =
  storage.kind === 'durable'
    ? await PostgresPilotStore.open({
        connectionString: storage.databaseUrl,
        schema: storage.schema,
      })
    : new MemoryPilotStore();
const objects =
  storage.kind === 'durable'
    ? await AzureBlobObjectStore.open(
        'connectionString' in storage.blob
          ? storage.blob
          : {
              accountUrl: storage.blob.accountUrl,
              container: storage.blob.container,
              credential: managedIdentityCredential({ clientId: storage.blob.clientId }),
            },
      )
    : new MemoryObjectStore();

const api = createPilotHandler({
  clientId: config.clientId,
  allowedEmailDomain: config.allowedEmailDomain,
  origin: config.origin,
  keys: devKey ? staticKeySource({ 'dev-key': createPublicKey(devKey) }) : googleKeySource(),
  store,
  objects,
  quotaBytes: config.quotaBytes,
  devSigner,
  google: config.clientSecret ? { clientSecret: config.clientSecret } : undefined,
  trustProxy: config.trustProxy,
  limits: { signInBurst: config.signInPerMinute, signInPerMinute: config.signInPerMinute },
});
createServer(createStaticHandler(config.staticDir, api)).listen(config.port, config.host, () => {
  console.log(`Pilot server on ${config.origin} (listening on ${config.host}:${config.port}).`);
  console.log(
    storage.kind === 'durable'
      ? `Storage: PostgreSQL (schema ${storage.schema}) and Azure Blob (container ${storage.blob.container}).`
      : 'Storage is in memory only: everything is lost when the server stops.',
  );
  if (devKey) console.log('Development sign-in is on: any typed IITGN email can sign in.');
});

// Clean up expired sessions, sign-in attempts and abandoned uploads now and every 10 minutes.
const cleanUp = () =>
  cleanUpPilot({ store, objects }).catch((cause: unknown) =>
    console.error('Pilot clean-up failed', cause),
  );
void cleanUp();
setInterval(cleanUp, 10 * 60_000).unref();
