// Runs the pilot tests with real PostgreSQL and Azurite (Azure Blob emulator) in Docker, then
// removes both containers. Usage: npm run test:pilot:storage [-- vitest filters]
import { execFileSync, spawnSync } from 'node:child_process';

const POSTGRES = 'postgres:17-alpine';
const AZURITE = 'mcr.microsoft.com/azure-storage/azurite:3.35.0';
// Azurite's published development account; it only exists inside the emulator.
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = `anyrecall-pilot-test-${process.pid}`;
const started = [];

try {
  started.push(
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      `${id}-pg`,
      '-e',
      'POSTGRES_PASSWORD=pilot-test',
      '-p',
      '127.0.0.1::5432',
      POSTGRES,
    ),
  );
  started.push(
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      `${id}-blob`,
      '-p',
      '127.0.0.1::10000',
      AZURITE,
      'azurite-blob',
      '--blobHost',
      '0.0.0.0',
      '--skipApiVersionCheck',
      '--loose',
    ),
  );
  const port = (name, inner) => docker('port', name, inner).split('\n')[0].split(':').at(-1);
  const pgPort = port(`${id}-pg`, '5432/tcp');
  const blobPort = port(`${id}-blob`, '10000/tcp');

  for (let i = 0; ; i++) {
    const ready = spawnSync('docker', [
      'exec',
      `${id}-pg`,
      'pg_isready',
      '-U',
      'postgres',
      '-h',
      '127.0.0.1',
    ]);
    if (ready.status === 0) break;
    if (i > 60) throw new Error('PostgreSQL did not start.');
    await sleep(500);
  }
  for (let i = 0; ; i++) {
    const ok = await fetch(`http://127.0.0.1:${blobPort}/devstoreaccount1?comp=list`).then(
      () => true,
      () => false,
    );
    if (ok) break;
    if (i > 60) throw new Error('Azurite did not start.');
    await sleep(500);
  }

  const env = {
    ...process.env,
    PILOT_TEST_DATABASE_URL: `postgres://postgres:pilot-test@127.0.0.1:${pgPort}/postgres`,
    PILOT_TEST_BLOB_CONNECTION: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};BlobEndpoint=http://127.0.0.1:${blobPort}/devstoreaccount1;`,
  };
  const filters = process.argv.slice(2);
  const run = spawnSync(
    'npx',
    ['vitest', 'run', '--config', 'pilot/vitest.config.ts', ...(filters.length ? filters : [])],
    { stdio: 'inherit', env },
  );
  process.exitCode = run.status ?? 1;
} finally {
  for (const container of started) spawnSync('docker', ['stop', container], { stdio: 'ignore' });
}
