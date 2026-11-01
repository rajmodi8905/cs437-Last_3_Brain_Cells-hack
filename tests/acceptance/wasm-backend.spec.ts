import { test, expect } from '@playwright/test';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('same pinned embedding model runs text and vision on WASM offline after disposal', async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const { external } = await prepare(page, context);
  await page.evaluate(async () => {
    (window as any).__wasmImage = await (await fetch('/tests/fixtures/sample-07.png')).blob();
  });
  await context.setOffline(true);
  const report = await page.evaluate(async () => {
    const h = (window as any).harness;
    const create = () => {
      const model = new h.ModelClient();
      // Explicitly exercise the existing production fallback, without mocking inference.
      model.forceWasm = true;
      return model;
    };
    let model = create();
    let query: Float32Array;
    let dimensions: number[];
    let norms: number[];
    try {
      const documents = await model.documents(
        'Project groups may contain at most three students.',
        'Synthetic course guideline',
      );
      query = await model.query('How many classmates can work together?');
      const image = await model.image((window as any).__wasmImage);
      dimensions = [...documents.map((d: any) => d.vector.length), query.length, image.length];
      norms = [
        ...documents.map((d: any) => Math.hypot(...d.vector)),
        Math.hypot(...query),
        Math.hypot(...image),
      ];
      if (model.device !== 'wasm') throw Error('WASM backend was not actually used');
    } finally {
      await model.dispose();
    }
    model = create();
    try {
      const repeated = await model.query('How many classmates can work together?');
      return {
        dimensions,
        norms,
        backend: model.device,
        maxDifference: Math.max(...repeated.map((v: number, i: number) => Math.abs(v - query[i]))),
      };
    } finally {
      await model.dispose();
    }
  });
  expect(report.backend).toBe('wasm');
  expect(report.dimensions.length).toBeGreaterThanOrEqual(3);
  expect(report.dimensions.every((n: number) => n === 768)).toBe(true);
  expect(report.norms.every((n: number) => Math.abs(n - 1) < 0.001)).toBe(true);
  expect(report.maxDifference).toBeLessThan(0.00001);
  expect(external).toEqual([]);
});
