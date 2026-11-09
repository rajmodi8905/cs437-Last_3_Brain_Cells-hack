// Android's share sheet sends files, text and links to the installed app as a multipart POST
// to the manifest's share_target. The service worker answers it on the device: it keeps the
// share in a temporary Cache Storage entry and opens Add, which takes the share and deletes the
// copy. The student still saves with "Save locally". Nothing is sent anywhere.
// This module runs in the service worker and the page, so it uses no DOM or React.

export const SHARE_CACHE = 'campus-recall-share';
/** Relative to the app scope; the manifest's share_target action points here. */
export const SHARE_PATH = 'share-target';
/** The Add screen's address after a share, with the share's id. */
export const sharedAddHash = (id: string) => `#/add?share=${encodeURIComponent(id)}`;

export interface SharedDraft {
  tab: 'file' | 'note' | 'webpage';
  files: File[];
  title: string;
  text: string;
  url: string;
}
interface ShareFields {
  files: File[];
  title?: string;
  text?: string;
  url?: string;
}
interface ShareRecord {
  title: string;
  text: string;
  url: string;
  files: { name: string; type: string; lastModified: number }[];
}
const LINK = /^https?:\/\/\S+$/i;
const key = (scope: string, id: string, part: string) =>
  new URL(`${SHARE_PATH}/${encodeURIComponent(id)}/${part}`, scope).href;

/** Files go to Files; a link goes to Webpage; other text becomes a note. */
export function draftFromShare({ files, title = '', text = '', url = '' }: ShareFields) {
  const name = Array.from(title.trim()).slice(0, 120).join('');
  const body = text.trim();
  if (files.length) return { tab: 'file', files, title: '', text: '', url: '' } as SharedDraft;
  // Android often sends a shared link as the text.
  const link = LINK.test(url.trim()) ? url.trim() : LINK.test(body) ? body : '';
  if (link)
    return {
      tab: 'webpage',
      files: [],
      title: name,
      url: link,
      text: body === link ? '' : body,
    } as SharedDraft;
  return { tab: 'note', files: [], title: name, text: body, url: '' } as SharedDraft;
}

/** Service worker: keeps one share at a time and returns its id. */
export async function storeShare(form: FormData, scope: string) {
  const id = crypto.randomUUID();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  // An empty file field arrives as a nameless, empty file.
  const files = form
    .getAll('files')
    .filter((value): value is File => typeof value !== 'string' && value.name !== '');
  const record: ShareRecord = {
    title: field('title'),
    text: field('text'),
    url: field('url'),
    files: files.map(({ name, type, lastModified }) => ({ name, type, lastModified })),
  };
  await caches.delete(SHARE_CACHE);
  const cache = await caches.open(SHARE_CACHE);
  for (const [index, file] of files.entries())
    await cache.put(key(scope, id, `file/${index}`), new Response(file));
  await cache.put(
    key(scope, id, 'record'),
    new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json' } }),
  );
  return id;
}

/** Page: returns the share as an Add draft and deletes the temporary copy. */
export async function takeShare(id: string, scope: string): Promise<SharedDraft | undefined> {
  if (typeof caches === 'undefined') return undefined;
  const cache = await caches.open(SHARE_CACHE);
  const stored = await cache.match(key(scope, id, 'record'));
  if (!stored) return undefined;
  const record = (await stored.json()) as ShareRecord;
  const files: File[] = [];
  for (const [index, { name, type, lastModified }] of record.files.entries()) {
    const body = await cache.match(key(scope, id, `file/${index}`));
    if (body) files.push(new File([await body.blob()], name, { type, lastModified }));
  }
  await caches.delete(SHARE_CACHE);
  return draftFromShare({ ...record, files });
}
