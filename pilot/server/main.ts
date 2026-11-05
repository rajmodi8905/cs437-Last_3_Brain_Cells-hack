/// <reference types="node" />
// Local pilot server: the built PWA and the API on one origin. Run with `npm run pilot:server`.
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createPilotHandler } from './app';
import { loadConfig } from './config';
import { MemoryObjectStore, MemoryPilotStore } from './memory';
import { createStaticHandler } from './static';
import { googleKeySource, staticKeySource } from './tokens';

const config = loadConfig(process.env);
const keys = config.devPublicKeyFile
  ? staticKeySource({ 'dev-key': createPublicKey(readFileSync(config.devPublicKeyFile)) })
  : googleKeySource();
const api = createPilotHandler({
  projectId: config.projectId,
  allowedEmailDomain: config.allowedEmailDomain,
  origin: config.origin,
  keys,
  store: new MemoryPilotStore(),
  objects: new MemoryObjectStore(),
  quotaBytes: config.quotaBytes,
});
createServer(createStaticHandler(config.staticDir, api)).listen(config.port, config.host, () => {
  console.log(`Pilot server on ${config.origin} (listening on ${config.host}:${config.port}).`);
  console.log('Storage is in memory only: everything is lost when the server stops.');
  if (config.devPublicKeyFile) console.log('Using a local development signing key, not Google.');
});
