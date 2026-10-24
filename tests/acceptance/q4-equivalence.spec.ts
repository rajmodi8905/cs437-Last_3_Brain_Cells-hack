import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('WASM lowering equals independently recorded native quantized Gather output', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await prepare(page, context);
  const reference = JSON.parse(await readFile('tests/fixtures/q4-gather-expected.json', 'utf8'));
  const output = await page.evaluate(async (reference) => {
    const h = (window as any).harness;
    h.ort.env.wasm.wasmPaths = {
      mjs: new URL('/runtime/ort/ort-wasm-simd-threaded.mjs', location.href).href,
      wasm: new URL('/runtime/ort/ort-wasm-simd-threaded.wasm', location.href).href,
    };
    h.ort.env.wasm.numThreads = 1;
    const original = new Uint8Array(
      await (await fetch('/tests/fixtures/q4-gather.onnx')).arrayBuffer(),
    );
    const session = await h.ort.InferenceSession.create(h.lowerQuantizedGather(original), {
      executionProviders: ['wasm'],
    });
    const indices = new h.ort.Tensor(
      'int64',
      BigInt64Array.from(reference.indices.flat().map(BigInt)),
      [2, 3],
    );
    const result = await session.run({ indices });
    const values = Array.from(result.output.data);
    await session.release();
    return { values, dims: result.output.dims };
  }, reference);
  expect(output.dims).toEqual(reference.dimensions);
  expect(output.values.length).toBe(reference.values.length);
  output.values.forEach((v: any, i: number) => expect(v).toBeCloseTo(reference.values[i], 5));
});
