import { useEffect, useRef } from 'react';
// The source viewer has one entry in browser history, so Back (and Android's back gesture)
// closes it instead of leaving the screen. The entry carries this mark in history.state and
// keeps the screen's address, so hash routing never sees it.
const MARK = 'anyRecallViewer';
/** The address the viewer opened at. Back to it, without the mark, means Back left the viewer. */
let openedAt: string | undefined;
/** True between our own history.back() and the popstate it causes. */
let leaving = false;

const onTop = () => !!(history.state as Record<string, unknown> | null)?.[MARK];

/**
 * Call from the tap, click or key handler that opens a viewer. Chromium skips history entries
 * added without a user activation, so the entry must be added there, not in an effect. Opening
 * another item while a viewer is open reuses the entry.
 */
export function enterViewer() {
  openedAt = location.href;
  if (onTop()) return;
  // The list keeps the position the student scrolled to while the viewer was open.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  history.pushState({ ...(history.state as object | null), [MARK]: true }, '');
}

/** After the viewer closed another way (its button, Escape, a deleted item): drop its entry. */
function leaveViewer() {
  if (!onTop() || leaving) return;
  leaving = true;
  history.back();
}

/**
 * For a screen change that also closes the viewer: the new screen takes the viewer's entry,
 * so Back from it returns to the screen before. Returns false when there is no viewer entry.
 */
export function navigateFromViewer(hash: string) {
  if (!onTop()) return false;
  if (location.hash === hash) leaveViewer();
  else location.replace(hash);
  return true;
}

/**
 * Keeps the viewer and its history entry in step. `close` closes whichever viewer is open.
 * Where the browser has CloseWatcher (Chrome, Firefox), Android Back and Escape reach the
 * viewer through it; elsewhere popstate does the same job.
 */
export function useViewerHistory(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    leaving = false;
    const pop = () => {
      if (leaving) {
        leaving = false;
        return;
      }
      // A link to another screen also fires popstate; only Back to the viewer's address closes it.
      if (!onTop() && location.href === openedAt) closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) leaveViewer();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    const Watcher = (
      window as {
        CloseWatcher?: new () => { onclose: (() => void) | null; destroy(): void };
      }
    ).CloseWatcher;
    if (!open || !Watcher) return;
    const watcher = new Watcher();
    watcher.onclose = () => closeRef.current();
    return () => watcher.destroy();
  }, [open]);
}
