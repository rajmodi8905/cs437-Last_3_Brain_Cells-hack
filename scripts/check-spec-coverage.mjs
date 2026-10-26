import { readFile } from 'node:fs/promises';
const spec = await readFile('SPEC.md', 'utf8');
const ids = [...spec.matchAll(/^### (S\d+)\b/gm)].map((m) => m[1]);
const coverage = JSON.parse(await readFile('tests/spec/coverage.json', 'utf8'));
if (new Set(ids).size !== ids.length || ids.length < 10)
  throw Error('SPEC needs at least ten unique statements.');
if (JSON.stringify(ids) !== JSON.stringify(coverage.statements.map((s) => s.id)))
  throw Error('Coverage registry must list every SPEC ID once, in order.');
for (const statement of coverage.statements) {
  if (!statement.files?.length || !statement.scope || !Array.isArray(statement.remaining))
    throw Error(`Incomplete registry entry: ${statement.id}`);
  for (const file of statement.files) {
    if (!/^tests\/.+\.(?:test|spec)\.tsx?$/.test(file) && file !== 'tests/acceptance/helpers.ts')
      throw Error(`Invalid test path: ${file}`);
    await readFile(file, 'utf8');
  }
}
console.log(
  `All ${ids.length} statements map to executable test suites. This checks registry completeness, not behavioral passes; run npm test for results.`,
);
