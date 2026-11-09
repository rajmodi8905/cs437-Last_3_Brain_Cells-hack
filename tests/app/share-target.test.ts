// A share from another app (Android share sheet): the service worker keeps it in a temporary
// local cache, and Add turns it into a draft and deletes the copy. Runs in Node, whose File,
// FormData and Response match the browser's; Cache Storage is an in-memory stand-in.
import { afterEach, expect, it, vi } from 'vitest';
import { draftFromShare, storeShare, takeShare } from '../../src/app/shareTarget';

afterEach(() => vi.unstubAllGlobals());

it('turns a share into the matching Add draft', () => {
  const photo = new File([new Uint8Array([1, 2, 3])], 'timetable.png', { type: 'image/png' });
  expect(draftFromShare({ files: [photo], title: 'Shared', text: '', url: '' })).toMatchObject({
    tab: 'file',
    files: [photo],
  });
  expect(
    draftFromShare({ files: [], title: 'Mess', text: 'Dinner at 7:30 pm.', url: '' }),
  ).toMatchObject({ tab: 'note', title: 'Mess', text: 'Dinner at 7:30 pm.' });
  expect(
    draftFromShare({ files: [], title: 'Notice', text: 'Read this', url: 'https://example.org/a' }),
  ).toMatchObject({ tab: 'webpage', url: 'https://example.org/a', text: 'Read this' });
  // Android often sends a link as the text.
  expect(
    draftFromShare({ files: [], title: '', text: ' https://example.org/b ', url: '' }),
  ).toMatchObject({ tab: 'webpage', url: 'https://example.org/b', text: '' });
});

it('keeps a share in a temporary local cache and hands it over once', async () => {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: async (key: string, value: Response) => void store.set(String(key), value),
      match: async (key: string) => store.get(String(key))?.clone(),
      delete: async (key: string) => store.delete(String(key)),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
    };
  };
  vi.stubGlobal('caches', {
    open,
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
  });
  const form = new FormData();
  form.set('title', 'Lab');
  form.set('text', '');
  form.append('files', new File(['first'], 'one.pdf', { type: 'application/pdf' }));
  form.append('files', new File(['second'], 'two.png', { type: 'image/png' }));
  form.append('files', new File([], '', { type: 'application/octet-stream' }));
  const id = await storeShare(form, 'https://app.test/');
  const draft = await takeShare(id, 'https://app.test/');
  expect(draft?.tab).toBe('file');
  expect(draft?.files.map((f) => [f.name, f.type])).toEqual([
    ['one.pdf', 'application/pdf'],
    ['two.png', 'image/png'],
  ]);
  expect(await draft?.files[1]!.text()).toBe('second');
  expect(await takeShare(id, 'https://app.test/')).toBeUndefined();
  const left = [...stores.values()].reduce((n, store) => n + store.size, 0);
  expect(left).toBe(0);
});
