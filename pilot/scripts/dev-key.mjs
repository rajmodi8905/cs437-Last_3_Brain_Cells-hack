// Creates a throwaway local signing key for development sign-in, once, in the ignored .cache/.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const dir = '.cache/pilot-dev-key';
const file = `${dir}/dev-private.pem`;
if (!existsSync(file)) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
