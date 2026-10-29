import { AppOperationError, LIMITS } from '../shared';
import { pdfjs } from '../shared/browser-assets';
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
/** Selectable text from a PDF snapshot. Scanned pages need the Files tab, where OCR runs. */
export async function extractPdfText(
  file: Blob,
): Promise<{ title: string; text: string; truncated: boolean }> {
  if (file.size > LIMITS.maxPdfBytes) throw new Error('PDF snapshot must be 20 MB or smaller.');
  const pdf = await pdfjs();
  const task = pdf.getDocument({
    data: await file.arrayBuffer(),
    useSystemFonts: true,
    useWasm: false,
  });
  try {
    const document = await task.promise.catch(() => {
      throw new Error('This PDF snapshot could not be read. It may be encrypted or damaged.');
    });
    if (document.numPages > LIMITS.maxPdfPages)
      throw new Error('This PDF exceeds 50 pages. Split it into smaller documents.');
    const pages: string[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '',
          )
          .join(''),
      );
      page.cleanup();
    }
    const text = pages
      .join('\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    if (!text)
      throw new Error('This PDF has no selectable text. Save it from the Files tab instead.');
    const info = (await document.getMetadata().catch(() => undefined))?.info as
      { Title?: unknown } | undefined;
    const title = typeof info?.Title === 'string' ? info.Title.trim() : '';
    return {
      title: Array.from(title).slice(0, LIMITS.maxTitleCodePoints).join(''),
      truncated: Array.from(text).length > LIMITS.maxTextCodePoints,
      text: Array.from(text).slice(0, LIMITS.maxTextCodePoints).join(''),
    };
  } finally {
    await task.destroy();
  }
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
