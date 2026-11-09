// @vitest-environment jsdom
// Phone feel: Back closes the viewer without leaving extra history, the item menu closes on an
// outside tap or Escape, the library asks once per session to be kept, Chromium gets one
// install offer after a save, and iPhone Safari is detected for the Home Screen tip. The
// engine and storage are injected stubs. Shares from other apps: share-target.test.ts.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import type { LibraryItem } from '../../src/shared';
import { createPersistenceRequest, isIosBrowserTab } from '../../src/app/phone';

const original = { storage: navigator.storage };
beforeEach(() => {
  // jsdom has no object URLs; the viewer only needs a placeholder.
  Object.assign(URL, { createObjectURL: () => 'blob:placeholder', revokeObjectURL: () => {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: original.storage });
});

const item = (id: string, title: string): LibraryItem => ({
  id,
  kind: 'note',
  title,
  mimeType: 'text/plain',
  byteLength: 40,
  contentSha256: id,
  originalBlobId: `blob-${id}`,
  createdAt: 1,
  status: 'ready',
  processingGeneration: 1,
});

function stubServices(items: LibraryItem[]) {
  const preferences = new Map<string, unknown>([['intro-seen', true]]);
  const services: CampusRecallServices = {
    initialize: vi.fn(async () => {}),
    subscribeLibrary(next) {
      next(items);
      return () => {};
    },
    preferences: {
      get: async <T,>(key: string) => preferences.get(key) as T | undefined,
      set: vi.fn(async (key: string, value: unknown) => void preferences.set(key, value)),
    },
    library: {
      save: vi.fn(async () => item('saved', 'Saved note')),
      getItem: async () => items[0],
      getOriginal: vi.fn(async () => new Blob(['Original text'], { type: 'text/plain' })),
      listItems: async () => items,
      renameItem: vi.fn(),
      deleteItem: vi.fn(),
      exportItems: vi.fn(async () => new Blob(['zip'])),
      importArchive: vi.fn(),
    },
    engine: {
      ready: true,
      downloadBytes: 1000,
      search: vi.fn(async () => []),
      setupModels: vi.fn(async () => {}),
      indexItem: vi.fn(async () => {}),
      cancelItem: vi.fn(async () => {}),
      subscribeProgress: () => () => {},
      dispose: vi.fn(async () => {}),
    } as unknown as CampusRecallServices['engine'],
    capture: {
      captureWebpage: vi.fn(),
      extractHtml: vi.fn(),
      extractPdfText: vi.fn(),
      validateWebUrl: vi.fn(),
    },
  };
  return { services, preferences };
}
async function start(services: CampusRecallServices, hash = '/library') {
  window.location.hash = hash;
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
}
const go = (hash: string) =>
  act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const viewer = () => document.querySelector('.preview-panel');
const back = () =>
  act(async () => {
    history.back();
    await new Promise((done) => window.addEventListener('popstate', done, { once: true }));
  });
async function saveNote(text = 'Dinner is at 7:30 pm.') {
  await go('/add');
  fireEvent.click(screen.getByRole('tab', { name: 'Note' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: text } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save locally' }).closest('form')!);
  await screen.findByText(/Saved locally/);
}
function stubStorage(persisted: boolean, grant: boolean) {
  let granted = persisted;
  const storage = {
    estimate: async () => ({ usage: 1000, quota: 100000 }),
    persisted: vi.fn(async () => granted),
    persist: vi.fn(async () => (granted = grant)),
  };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
  return storage;
}

it('Back closes the viewer, and closing it with its button removes its history entry', async () => {
  const { services } = stubServices([item('a', 'Mess timings'), item('b', 'Bus timings')]);
  await start(services);
  const length = history.length;
  fireEvent.click(screen.getByRole('button', { name: /^Mess timings/ }));
  await screen.findByRole('region', { name: 'Mess timings' });
  expect(history.length).toBe(length + 1);
  // Opening another item while the viewer is open reuses the entry.
  fireEvent.click(screen.getByRole('button', { name: /^Bus timings/ }));
  await screen.findByRole('region', { name: 'Bus timings' });
  expect(history.length).toBe(length + 1);
  await back();
  await waitFor(() => expect(viewer()).toBeNull());
  expect(window.location.hash).toBe('#/library');

  fireEvent.click(screen.getByRole('button', { name: /^Mess timings/ }));
  const region = await screen.findByRole('region', { name: 'Mess timings' });
  const leave = vi.spyOn(history, 'back');
  fireEvent.click(within(region).getByRole('button', { name: 'Close original' }));
  await waitFor(() => expect(viewer()).toBeNull());
  expect(leave).toHaveBeenCalledOnce();
  leave.mockRestore();
});

it('a search from the open viewer replaces its entry instead of leaving a dead Back step', async () => {
  const { services } = stubServices([item('a', 'Mess timings')]);
  await start(services);
  fireEvent.click(screen.getByRole('button', { name: /^Mess timings/ }));
  await screen.findByRole('region', { name: 'Mess timings' });
  const length = history.length;
  const box = screen.getByRole('textbox', { name: 'Search saved information' });
  fireEvent.change(box, { target: { value: 'dinner' } });
  fireEvent.submit(box.closest('form')!);
  await waitFor(() => expect(window.location.hash).toBe('#/search'));
  await waitFor(() => expect(viewer()).toBeNull());
  expect(history.length).toBe(length);
});

it('the item menu closes on a tap outside and on Escape, which leaves the viewer open', async () => {
  const { services } = stubServices([item('a', 'Mess timings')]);
  await start(services);
  fireEvent.click(screen.getByRole('button', { name: /^Mess timings/ }));
  await screen.findByRole('region', { name: 'Mess timings' });
  const actions = screen.getByRole('button', { name: 'Actions for Mess timings' });
  fireEvent.click(actions);
  expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  // A tap inside the menu does not close it.
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Rename' }));
  expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeNull();
  fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull());
  expect(actions.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(actions);
  screen.getByRole('button', { name: 'Rename' }).focus();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull());
  expect(document.activeElement).toBe(actions);
  expect(viewer()).not.toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(viewer()).toBeNull());
});

it('asks the browser to keep the library after a save, once per session', async () => {
  const storage = stubStorage(false, false);
  const { services } = stubServices([item('a', 'Mess timings')]);
  await start(services);
  expect(storage.persist).not.toHaveBeenCalled();
  await saveNote();
  await waitFor(() => expect(storage.persist).toHaveBeenCalledOnce());
  await saveNote('Second note');
  await act(async () => {});
  expect(storage.persist).toHaveBeenCalledOnce();
  await go('/settings');
  expect(
    await screen.findByRole('button', { name: 'Keep my library on this device' }),
  ).toBeTruthy();
});

it('Settings says the library is kept once persistence is granted', async () => {
  stubStorage(true, true);
  const { services } = stubServices([item('a', 'Mess timings')]);
  await start(services, '/settings');
  expect(
    await screen.findByText('This browser will keep your library unless you clear site data.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Keep my library on this device' })).toBeNull();
});

it('the persistence request skips a granted library and repeats nothing in a session', async () => {
  const granted = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) };
  await createPersistenceRequest(granted)();
  expect(granted.persist).not.toHaveBeenCalled();
  const refused = { persisted: vi.fn(async () => false), persist: vi.fn(async () => false) };
  const request = createPersistenceRequest(refused);
  expect(await request()).toBe(false);
  expect(await request()).toBe(false);
  expect(refused.persist).toHaveBeenCalledOnce();
  expect(await createPersistenceRequest(undefined)()).toBeUndefined();
});

function installEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
  });
  return { event, prompt };
}
const OFFER = 'Install Campus Recall for quick access and so your library is kept';

it('offers to install once after a save, and remembers Not now', async () => {
  const { services, preferences } = stubServices([item('a', 'Mess timings')]);
  await start(services);
  const { event } = installEvent();
  act(() => void window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(screen.queryByText(OFFER)).toBeNull();
  await saveNote();
  expect(await screen.findByText(OFFER)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByText(OFFER)).toBeNull());
  expect(preferences.get('install-offer-declined')).toBe(true);
  await saveNote('Another');
  expect(screen.queryByText(OFFER)).toBeNull();
});

it('Install opens the browser prompt, and an installed app is not offered again', async () => {
  const { services } = stubServices([item('a', 'Mess timings')]);
  await start(services);
  const { event, prompt } = installEvent();
  act(() => void window.dispatchEvent(event));
  await saveNote();
  fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
  await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByText(OFFER)).toBeNull());

  cleanup();
  const second = stubServices([item('a', 'Mess timings')]);
  await start(second.services);
  act(() => void window.dispatchEvent(installEvent().event));
  act(() => void window.dispatchEvent(new Event('appinstalled')));
  await saveNote();
  expect(screen.queryByText(OFFER)).toBeNull();
});

it('does not show the install offer while the welcome dialog is open', async () => {
  const { services, preferences } = stubServices([item('a', 'Mess timings')]);
  preferences.delete('intro-seen');
  await start(services);
  act(() => void window.dispatchEvent(installEvent().event));
  await screen.findByRole('dialog');
  expect(screen.queryByText(OFFER)).toBeNull();
});

it('recognises iPhone and iPad Safari outside the Home Screen app', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
  const android =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  expect(isIosBrowserTab({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true);
  expect(isIosBrowserTab({ userAgent: iphone, maxTouchPoints: 5, standalone: true })).toBe(false);
  // iPadOS Safari asks for desktop sites and reports a Mac with touch.
  expect(isIosBrowserTab({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  expect(isIosBrowserTab({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  expect(isIosBrowserTab({ userAgent: android, maxTouchPoints: 5 })).toBe(false);
});
