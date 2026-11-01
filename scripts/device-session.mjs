// Explicit local QA session. No deployment, device trust changes or private library access.
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { createServer } from 'node:https';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build, preview } from 'vite';
import { zipSync } from 'fflate';

const [command, ...args] = process.argv.slice(2);
if (!['prepare', 'serve'].includes(command) || args.length % 2)
  throw Error(
    'Use prepare --address <IPv4> [--directory <new-directory>] [--certificate-from <existing-session>] or serve [--directory <directory>] [--host 127.0.0.1|0.0.0.0] [--port <port>].',
  );
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (
    !['--address', '--directory', '--host', '--port', '--certificate-from'].includes(name) ||
    options[name] !== undefined
  )
    throw Error(`Unknown or duplicate argument: ${name}`);
  options[name] = args[index + 1];
}
const directory = resolve(options['--directory'] || '.cache/device-session');
const withinRepo = relative(process.cwd(), directory);
if (!withinRepo.startsWith(`..${sep}`) && !withinRepo.startsWith(`.cache${sep}`))
  throw Error('Session certificates must stay under ignored .cache/ or outside this repository.');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...arguments_) => execFileSync('git', arguments_, { encoding: 'utf8' }).trimEnd();
const json = (value) => JSON.stringify(value, null, 2) + '\n';
async function filesAt(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error(`Unexpected symlink in QA snapshot: ${name}`);
    if (entry.isDirectory()) result.push(...(await filesAt(root, name)));
    else result.push({ path: name, sha256: sha(await readFile(join(root, name))) });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function sourceIdentity() {
  const files = [
    ...new Set([
      ...git(
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'src',
        'public',
        'index.html',
        'vite.config.ts',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'docs/product/privacy-policy.md',
        'docs/product/terms-and-conditions.md',
        'docs/verification/retrieval-freeze.json',
        'scripts/model-assets.json',
        'scripts/prepare-assets.mjs',
        'scripts/prepare-qa-kit.mjs',
      )
        .split('\0')
        .filter(Boolean),
      'scripts/device-session.mjs',
    ]),
  ].sort();
  const hashes = [];
  for (const path of files) hashes.push({ path, sha256: sha(await readFile(path)) });
  return {
    commit: git('rev-parse', 'HEAD'),
    runtimeInputsClean: !git('status', '--porcelain', '--untracked-files=all', '--', ...files),
    inputHash: sha(Buffer.from(json(hashes))),
    files: hashes,
  };
}
const app = join(directory, 'app');
const privateDirectory = join(directory, 'private');
if (command === 'prepare') {
  const address = options['--address'];
  if (isIP(address || '') !== 4)
    throw Error('Supply the actual IPv4 LAN address, or 127.0.0.1 for a laptop-only check.');
  execFileSync('openssl', ['version'], { stdio: 'pipe' });
  // Exclusive creation preserves earlier certificates, snapshots and device notes.
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await mkdir(privateDirectory, { mode: 0o700 });
  const source = await sourceIdentity();
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/prepare-assets.mjs'], { stdio: 'inherit' });
  await build({ base: '/', build: { outDir: app, emptyOutDir: true } });
  execFileSync(
    process.execPath,
    ['scripts/prepare-qa-kit.mjs', '--output-dir', join(directory, 'kit')],
    { stdio: 'inherit' },
  );
  const qa = join(app, '__qa');
  await mkdir(qa);
  let rootCertificate, leafCertificate;
  if (options['--certificate-from']) {
    const previous = resolve(options['--certificate-from']);
    const rootBytes = await readFile(join(previous, 'app/__qa/root-ca.crt'));
    const key = await readFile(join(previous, 'private/server-key.pem'));
    const cert = await readFile(join(previous, 'private/server-cert.pem'));
    rootCertificate = new X509Certificate(rootBytes);
    leafCertificate = new X509Certificate(cert);
    if (
      !rootCertificate.ca ||
      !leafCertificate.checkPrivateKey(createPrivateKey(key)) ||
      !leafCertificate.verify(rootCertificate.publicKey) ||
      !leafCertificate.checkIP(address) ||
      Date.parse(leafCertificate.validTo) <= Date.now() ||
      Date.parse(rootCertificate.validTo) <= Date.now()
    )
      throw Error('Existing certificate is mismatched, expired or invalid for this address.');
    // Reuse deliberate owner trust without copying a root signing key or changing expiry.
    await writeFile(join(qa, 'root-ca.crt'), rootBytes);
    await writeFile(join(privateDirectory, 'server-key.pem'), key, { mode: 0o600 });
    await writeFile(join(privateDirectory, 'server-cert.pem'), cert);
  } else {
    const config = join(privateDirectory, 'certificate.cnf');
    await writeFile(
      config,
      `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Campus Recall Local QA Root\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n[server_cert]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=DNS:localhost,IP:127.0.0.1${address === '127.0.0.1' ? '' : `,IP:${address}`}\n`,
      { mode: 0o600 },
    );
    const openssl = (...arguments_) => execFileSync('openssl', arguments_, { stdio: 'pipe' });
    const caKey = join(privateDirectory, 'ca-key.pem');
    const caFile = join(qa, 'root-ca.crt');
    const keyFile = join(privateDirectory, 'server-key.pem');
    const certFile = join(privateDirectory, 'server-cert.pem');
    const csr = join(privateDirectory, 'server.csr');
    openssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '7',
      '-keyout',
      caKey,
      '-out',
      caFile,
      '-config',
      config,
      '-extensions',
      'v3_ca',
    );
    openssl(
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      csr,
      '-subj',
      '/CN=Campus Recall Local QA Server',
      '-config',
      config,
    );
    openssl(
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      caFile,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-CAserial',
      join(privateDirectory, 'ca.srl'),
      '-out',
      certFile,
      '-days',
      '7',
      '-sha256',
      '-extfile',
      config,
      '-extensions',
      'server_cert',
    );
    await chmod(caKey, 0o600);
    await chmod(keyFile, 0o600);
    rootCertificate = new X509Certificate(await readFile(caFile));
    leafCertificate = new X509Certificate(await readFile(certFile));
  }
  const material = {};
  for (const { path } of await filesAt(join(directory, 'kit')))
    material[path] = new Uint8Array(await readFile(join(directory, 'kit', path)));
  await writeFile(join(qa, 'fixtures.zip'), zipSync(material));
  await copyFile(join(directory, 'kit/expected.json'), join(qa, 'expected.json'));
  const freeze = JSON.parse(await readFile('docs/verification/retrieval-freeze.json', 'utf8'));
  if ((await sourceIdentity()).inputHash !== source.inputHash)
    throw Error(
      'Source inputs changed during preparation. Prepare a new session from stable files.',
    );
  const metadata = {
    kind: 'Campus Recall local device session',
    version: 1,
    preparedAt: new Date().toISOString(),
    address,
    basePath: '/',
    source,
    node: process.version,
    assetManifestSha256: sha(await readFile(join(app, 'asset-manifest.json'))),
    indexVersion: freeze.indexVersion,
    thresholds: freeze.thresholds,
    fixtureZipSha256: sha(await readFile(join(qa, 'fixtures.zip'))),
    certificate: {
      rootFingerprint256: rootCertificate.fingerprint256,
      leafFingerprint256: leafCertificate.fingerprint256,
      expiresAt: leafCertificate.validTo,
    },
    deviceResults: 'Not run; requires actual reference devices.',
    note: 'This QA-only snapshot includes synthetic fixture downloads. No certificate was installed or trusted. The recorded commit and input hashes distinguish local changes from main.',
  };
  await writeFile(join(qa, 'session.json'), json(metadata));
  await writeFile(
    join(directory, 'record.json'),
    json({ metadata, snapshotFiles: await filesAt(app) }),
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, 'DEVICE_STEPS.md'),
    `# Local device session\n\nPrepared source commit: ${source.commit}\nRuntime inputs clean against commit: ${source.runtimeInputsClean}\nSource hash: ${source.inputHash}\nAddress: ${address}\nSuggested app URL: https://${address}:4473/\nRoot certificate SHA-256 fingerprint: ${rootCertificate.fingerprint256}\nExpires: ${leafCertificate.validTo}\n\nStatus: Not run. No device pass or certificate trust is established by preparation.\n\nUse docs/implementation/device-session.md. Start with npm run qa:device:serve -- --directory "${directory}" --host 0.0.0.0. The public root certificate is app/__qa/root-ca.crt. Share only this certificate and public synthetic files; never share private/ or record.json. Device owners choose whether to install/trust the temporary root. No OS trust changes were made here.\n\nAfter setup, download /__qa/fixtures.zip and /__qa/expected.json. Record each agreed S8 image/PDF fixture separately with device/OS/browser, cold/warm state, fixture hash/bytes, start/end/elapsed time, final status and expected source location. S13 phone installation/keyboard/safe-area/zoom/playback and S15 factual review remain independent gates.\n\n| Scenario / SPEC | Device / mode | Expected | Actual / timing / attempts | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |\n| Not selected | Not recorded | Not recorded | Not observed | Not run | None |\n`,
  );
  console.log(`Device session prepared at ${directory}`);
  console.log(`Source ${source.commit}, runtime inputs clean: ${source.runtimeInputsClean}`);
  console.log(`Root fingerprint: ${rootCertificate.fingerprint256}`);
  console.log(
    'No device trust, phone tests or deployment performed. Read DEVICE_STEPS.md before starting.',
  );
} else {
  const record = JSON.parse(await readFile(join(directory, 'record.json'), 'utf8'));
  if (json(await filesAt(app)) !== json(record.snapshotFiles))
    throw Error(
      'Snapshot changed. Prepare a new device session rather than misidentifying the build.',
    );
  if ((await sourceIdentity()).inputHash !== record.metadata.source.inputHash)
    throw Error('Source inputs changed. Prepare a new session before testing this checkout.');
  const key = await readFile(join(privateDirectory, 'server-key.pem'));
  const cert = await readFile(join(privateDirectory, 'server-cert.pem'));
  const root = new X509Certificate(await readFile(join(app, '__qa/root-ca.crt')));
  const leaf = new X509Certificate(cert);
  if (
    !leaf.checkPrivateKey(createPrivateKey(key)) ||
    !leaf.verify(root.publicKey) ||
    !leaf.checkIP(record.metadata.address) ||
    Date.parse(leaf.validTo) <= Date.now() ||
    Date.parse(root.validTo) <= Date.now()
  )
    throw Error('Device certificate is mismatched or expired. Prepare a new session.');
  const port = Number(options['--port'] ?? 4473);
  const host = options['--host'] || '127.0.0.1';
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !['127.0.0.1', '0.0.0.0'].includes(host)
  )
    throw Error('Use a valid port and host 127.0.0.1 or 0.0.0.0.');
  // Use Vite's documented middleware interface with an HTTP/1.1 TLS server.
  // The default HTTP/2 preview lost its connection on the reference iPhone.
  const previewApp = await preview({
    base: '/',
    build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, strictPort: true, https: undefined },
  });
  await new Promise((resolve, reject) =>
    previewApp.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
  const server = createServer({ key, cert, ALPNProtocols: ['http/1.1'] }, previewApp.middlewares);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  console.log(
    `QA_DEVICE_URL=https://${host === '127.0.0.1' ? '127.0.0.1' : record.metadata.address}:${actualPort}`,
  );
  console.log(
    'Temporary local QA snapshot. Device certificate trust and network reachability require actual verification. Stop with Ctrl+C.',
  );
}
