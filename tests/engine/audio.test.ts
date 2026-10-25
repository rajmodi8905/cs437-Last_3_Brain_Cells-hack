import { it, expect } from 'vitest';
import { hasAudibleSamples, audibleRange } from '../../src/engine/audio';
it('rejects empty and near-silent samples without suppressing an audible interval', () => {
  expect(hasAudibleSamples(new Float32Array())).toBe(false);
  expect(hasAudibleSamples(new Float32Array(16000).fill(0.000001))).toBe(false);
  const signal = new Float32Array(16000);
  signal.fill(0.05, 8000, 12000);
  expect(hasAudibleSamples(signal)).toBe(true);
  expect(hasAudibleSamples(signal, 0, 8000)).toBe(false);
  expect(hasAudibleSamples(signal, 8000, 12000)).toBe(true);
});

it('retains original time offsets when trimming near-silent recording edges', () => {
  const input = new Float32Array(80000);
  input.fill(0.05, 48000, 64000);
  expect(audibleRange(input)).toEqual({ start: 46400, end: 65600 });
  expect(audibleRange(new Float32Array(16000))).toBeUndefined();
});
