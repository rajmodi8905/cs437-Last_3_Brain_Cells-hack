import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lowerQuantizedGather } from '../../src/engine/onnx-q4';
it('lowers the independent q4 fixture without retaining unsupported nodes', () => {
  const original = readFileSync('tests/fixtures/q4-gather.onnx');
  const result = lowerQuantizedGather(original);
  const names = new TextDecoder().decode(result);
  expect(names).not.toContain('GatherBlockQuantized');
  expect(names).toContain('Unsqueeze');
  expect(names).toContain('Reshape');
  expect(names).toContain('dequant');
  expect(result.length).toBeLessThan(10_000);
});
it('fails explicitly on malformed models', () => {
  expect(() => lowerQuantizedGather(new Uint8Array([255]))).toThrow();
  expect(() => lowerQuantizedGather(new Uint8Array())).toThrow(/missing/);
});
