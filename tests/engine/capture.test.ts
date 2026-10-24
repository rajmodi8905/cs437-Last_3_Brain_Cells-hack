// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { extractHtml, captureWebpage, validateWebUrl } from '../../src/engine/capture';
it('extracts inert page text and excludes executable/navigation content', () => {
  const result = extractHtml(
    '<title>Title</title><nav>menu</nav><main><h1>Campus</h1><p>Tryouts Friday.</p><script>alert(1)</script><iframe src="https://x.test"></iframe><img src="https://x.test/leak"></main>',
  );
  expect(result.title).toBe('Title');
  expect(result.text).toContain('Tryouts Friday.');
  expect(result.text).not.toMatch(/alert|menu/);
});
it('requires ordinary public URL protocols and no embedded credentials', () => {
  expect(() => validateWebUrl('javascript:alert(1)')).toThrow();
  expect(() => validateWebUrl('https://name:secret@example.com')).toThrow();
});
it('omits credentials and maps blocked fetches to a usable fallback', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('CORS'));
  vi.stubGlobal('fetch', fetch);
  await expect(captureWebpage('https://example.test')).rejects.toMatchObject({
    detail: { code: 'FETCH_BLOCKED' },
  });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  vi.unstubAllGlobals();
});
it('reports bounded snapshot truncation without counting UTF-16 halves as characters', () => {
  const result = extractHtml(`<main>${'😀'.repeat(20_001)}</main>`);
  expect(Array.from(result.text)).toHaveLength(20_000);
  expect(result.truncated).toBe(true);
});
