import { AppOperationError, LIMITS } from '../shared';
export function extractHtml(html: string): { title: string; text: string; truncated: boolean } {
  // Template contents are inert. Never attach them to the active document.
  const template = document.createElement('template');
  template.innerHTML = html;
  const doc = template.content;
  const title = doc.querySelector('title')?.textContent?.trim() ?? '';
  doc
    .querySelectorAll(
      'script,style,noscript,iframe,object,embed,nav,footer,header,form,svg,img,link,meta,base,source,video,audio,title',
    )
    .forEach((el) => el.remove());
  const main = doc.querySelector('article,main') ?? doc;
  main.querySelectorAll('p,div,li,h1,h2,h3,h4,br,tr,section').forEach((el) => el.append('\n'));
  const text = (main.textContent ?? '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  return {
    title,
    truncated: Array.from(text).length > LIMITS.maxTextCodePoints,
    text: Array.from(text).slice(0, LIMITS.maxTextCodePoints).join(''),
  };
}
export function validateWebUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Enter a public HTTP or HTTPS URL without credentials.');
  return url;
}
export async function captureWebpage(
  value: string,
): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  const url = validateWebUrl(value);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Website request failed.');
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain'))
      throw new Error('Save this document as a file instead.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No content.');
    let length = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        throw new Error('Page is too large.');
      }
      parts.push(value);
    }
    const html = await new Blob(parts as BlobPart[]).text();
    const extracted = contentType.includes('html')
      ? extractHtml(html)
      : {
          title: url.hostname,
          text: Array.from(html).slice(0, 20_000).join(''),
          truncated: Array.from(html).length > 20_000,
        };
    if (!extracted.text.trim()) throw new Error('No readable content.');
    return { url: url.href, ...extracted };
  } catch {
    throw new AppOperationError({
      code: 'FETCH_BLOCKED',
      message:
        'This website could not be captured. Paste its text below, or import an HTML or PDF snapshot. Your browser may block direct access.',
      retryable: false,
    });
  }
}
