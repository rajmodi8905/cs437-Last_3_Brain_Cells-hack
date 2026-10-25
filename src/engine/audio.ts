/** Energy gate only. It does not classify environmental sounds or replace speech recognition. */
export function hasAudibleSamples(samples: Float32Array, start = 0, end = samples.length): boolean {
  const first = Math.max(0, Math.floor(start)),
    last = Math.min(samples.length, Math.ceil(end));
  if (last <= first) return false;
  let energy = 0;
  for (let i = first; i < last; i++) energy += samples[i] * samples[i];
  return Math.sqrt(energy / (last - first)) >= 0.0001;
}
/** Trim only near-silent edges, retaining 100 ms of context and an original-sample offset. */
export function audibleRange(samples: Float32Array): { start: number; end: number } | undefined {
  const block = 160,
    context = 1600;
  let first = -1,
    last = -1;
  for (let i = 0; i < samples.length; i += block)
    if (hasAudibleSamples(samples, i, i + block)) {
      first = i;
      break;
    }
  if (first < 0) return undefined;
  for (let end = samples.length; end > first; end -= block)
    if (hasAudibleSamples(samples, end - block, end)) {
      last = end;
      break;
    }
  return { start: Math.max(0, first - context), end: Math.min(samples.length, last + context) };
}
