import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolve through the consumers so a broken override cannot pass by testing an unused copy.
const require = createRequire(import.meta.url);
const workboxRequire = createRequire(require.resolve('workbox-build'));
const resolverRequire = createRequire(workboxRequire.resolve('@rollup/plugin-node-resolve'));
const merge = resolverRequire('deepmerge');

describe('build dependency security regressions', () => {
  it('does not inherit attacker properties through a nested placeholder or null prototype', () => {
    const source = JSON.parse('{"session":{"__proto__":{"admin":true},"valid":1}}');
    for (const session of [null, undefined, false, 3]) {
      const result = merge({ session }, source);
      expect(Object.getPrototypeOf(result.session)).toBe(Object.prototype);
      expect(result.session.admin).toBeUndefined();
      expect(result.session.valid).toBe(1);
    }
    const result = merge(Object.create(null), JSON.parse('{"__proto__":{"admin":true}}'));
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.admin).toBeUndefined();
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it('blocks reserved keys in both target copying and source merging, recursively', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const value = JSON.parse(`{"${key}":{"admin":true},"safe":{"value":2}}`);
      for (const result of [merge(value, {}), merge({}, value), merge({ nested: value }, {})]) {
        const checked = result.nested ?? result;
        expect(Object.hasOwn(checked, key)).toBe(false);
        expect(Object.getPrototypeOf(checked)).toBe(Object.prototype);
        expect(checked.safe.value).toBe(2);
      }
    }
  });

  it('keeps inherited or unreadable target properties out of the result', () => {
    const inherited = Object.create({ hidden: { old: true } });
    expect(merge(inherited, { hidden: { injected: true }, safe: 1 })).toEqual({ safe: 1 });
    const unreadable = new Proxy(
      {},
      {
        has() {
          throw new Error('unreadable target');
        },
      },
    );
    expect(merge(unreadable, { injected: true })).toEqual({});
  });

  it('preserves ordinary resolver merge options, arrays, symbols and custom merging', () => {
    const symbol = Symbol('build-option');
    const original = { nested: { a: 1 }, extensions: ['.mjs'], [symbol]: { value: 1 } };
    const result = merge(original, { nested: { b: 2 }, extensions: ['.js'] });
    expect(result.nested).toEqual({ a: 1, b: 2 });
    expect(result.extensions).toEqual(['.mjs', '.js']);
    expect(result[symbol]).toEqual({ value: 1 });
    expect(result.nested).not.toBe(original.nested);
    expect(merge({}, original, { clone: false }).nested).toBe(original.nested);
    expect(merge.all([{ a: 1 }, { b: 2 }])).toEqual({ a: 1, b: 2 });
    expect(
      merge(
        { list: [1] },
        { list: [2] },
        {
          customMerge: (key: string) =>
            key === 'list' ? (_a: unknown, b: unknown) => b : undefined,
        },
      ),
    ).toEqual({ list: [2] });
  });

  it('retains the matcher exports and file enumeration used by ESLint, FileList and Workbox', async () => {
    const eslintRequire = createRequire(require.resolve('eslint'));
    const { Minimatch, match } = eslintRequire('minimatch');
    expect(new Minimatch('**/*.{ts,tsx}', { dot: true }).match('src/ui/App.tsx')).toBe(true);
    expect(match(['src/a.ts', 'src/a.js'], '**/*.ts')).toEqual(['src/a.ts']);
    const directory = await mkdtemp(join(tmpdir(), 'campus-build-deps-'));
    try {
      await mkdir(join(directory, 'assets'));
      await mkdir(join(directory, 'runtime'));
      for (const file of [
        'index.html',
        '.hidden.js',
        'assets/app.js',
        'assets/app.css',
        'runtime/worker.js',
      ])
        await writeFile(join(directory, file), 'synthetic build fixture');
      const { globSync } = workboxRequire('glob');
      // glob returns native separators; Workbox converts them with upath, as here.
      expect(
        globSync('**/*.{js,css,html}', {
          cwd: directory,
          ignore: ['runtime/**'],
          nodir: true,
          dot: false,
        })
          .map((file: string) => file.replaceAll('\\', '/'))
          .sort(),
      ).toEqual(['assets/app.css', 'assets/app.js', 'index.html']);
      const offThreadRequire = createRequire(
        workboxRequire.resolve('@trickfilm400/rollup-plugin-off-main-thread'),
      );
      const ejsRequire = createRequire(offThreadRequire.resolve('ejs'));
      const jakeRequire = createRequire(ejsRequire.resolve('jake'));
      const { FileList } = jakeRequire('filelist');
      expect(FileList).toBeTypeOf('function');
      // filelist path.normalize()s its pattern to "\" on Windows, which minimatch 11 reads as
      // escapes, so it matches nothing there for any input. Only ejs's CLI uses it, not the build.
      if (process.platform !== 'win32') {
        const files = new FileList(join(directory, '**/*.{js,css}'));
        expect(
          files
            .toArray()
            .map((file: string) => file.slice(directory.length + 1))
            .sort(),
        ).toEqual(['assets/app.css', 'assets/app.js', 'runtime/worker.js']);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
