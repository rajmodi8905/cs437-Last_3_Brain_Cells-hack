import { readFile } from 'node:fs/promises';
import { validateMapping } from './spec-evidence.mjs';
const spec = await readFile('SPEC.md', 'utf8');
const ids = [...spec.matchAll(/^### (S\d+)\b/gm)].map((m) => m[1]);
const coverage = JSON.parse(await readFile('tests/spec/coverage.json', 'utf8'));
if (new Set(ids).size !== ids.length || ids.length < 10)
  throw Error('SPEC needs at least ten unique statements.');
const { errors } = validateMapping(coverage, ids);
const files = new Set(coverage.statements.flatMap((s) => (s.tests ?? []).map((t) => t.file)));
for (const file of files) {
  if (!/^tests\/.+\.(?:test|spec)\.tsx?$/.test(file)) errors.push(`Invalid test path: ${file}`);
  else await readFile(file, 'utf8').catch(() => errors.push(`Missing test file: ${file}`));
}
if (errors.length) throw Error(`Coverage registry is invalid:\n${errors.join('\n')}`);
const tests = coverage.statements.reduce((n, s) => n + s.tests.length, 0);
console.log(
  `All ${ids.length} statements map to ${tests} required test identities in ${files.size} files. This checks the registry contract only; run npm run spec:mapping for stale titles and npm run spec:summary after tests for executed results.`,
);
