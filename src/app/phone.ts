// Phone platform helpers: keeping the library on the device, Chromium's install offer and
// telling iPhone Safari apart from the Home Screen app. Each takes its browser object as an
// argument so tests can pass their own.

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** Safari on iPhone and iPad: true inside a Home Screen web app. */
  standalone?: boolean;
}

/**
 * True in Safari (or another browser) on iPhone or iPad, outside the Home Screen app. Safari
 * can clear website data after seven days without use; the Home Screen app keeps its own.
 */
export function isIosBrowserTab(nav: NavigatorLike = navigator as NavigatorLike) {
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    // iPadOS Safari requests desktop sites and reports a Mac with a touch screen.
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  return ios && nav.standalone !== true;
}

/** True when the app runs installed, from the Home Screen or as a desktop app. */
export function isInstalled(win: Window = window) {
  return (
    !!win.matchMedia?.('(display-mode: standalone)').matches ||
    (win.navigator as NavigatorLike).standalone === true
  );
}

type PersistentStorage = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;
/**
 * Returns a function that asks the browser to keep this site's data, at most once per app
 * session and only while it is not kept already. Chromium grants or refuses without a prompt.
 * The function resolves to whether the data is kept, or undefined when the browser cannot say.
 */
export function createPersistenceRequest(storage: PersistentStorage | undefined) {
  let asked = false;
  return async () => {
    if (!storage?.persisted || !storage.persist) return undefined;
    if (await storage.persisted()) return true;
    if (asked) return false;
    asked = true;
    return storage.persist();
  };
}

/** Chromium's install event. The browser shows its own install dialog on prompt(). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}
/** Preference set when the student answers the install offer, so it is not shown again. */
export const INSTALL_DECLINED = 'install-offer-declined';
