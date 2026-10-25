import { readFile, readdir } from 'node:fs/promises';
const files = [
  'docs/product/privacy-policy.md',
  'docs/product/terms-and-conditions.md',
  ...(await readdir('src/ui', { recursive: true }))
    .filter((file) => /\.(tsx?|css)$/.test(file))
    .map((file) => `src/ui/${file}`),
];
const issues = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (text.includes('\u2014')) issues.push(`${file}: authored em dash`);
  if (/(?:linear|radial|conic)-gradient\s*\(/i.test(text))
    issues.push(`${file}: decorative gradient`);
  if (/100%\s*(?:secure|private)|fake customer|lorem ipsum/i.test(text))
    issues.push(`${file}: prohibited claim or placeholder`);
  if (/fonts\.(?:googleapis|gstatic)\.com/.test(text))
    issues.push(`${file}: external font request`);
}
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Product copy/style restrictions passed. Imported originals are not scanned or rewritten.',
  );
