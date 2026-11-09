import { useEffect, useLayoutEffect, useRef } from 'react';

const TITLES: Record<string, string> = {
  library: 'Library',
  search: 'Search',
  add: 'Add to library',
  settings: 'Settings',
  privacy: 'Privacy Policy',
  terms: 'Terms and Conditions',
};
export const screenTitle = (screen: string) =>
  screen === 'home' ? 'Campus Recall' : `${TITLES[screen] ?? 'Page not found'} · Campus Recall`;

/** Focuses the main heading, unless a dialog owns focus. Returns false while there is none. */
function focusHeading() {
  const heading = document.querySelector<HTMLElement>('#main h1');
  if (!heading) return false;
  if (document.querySelector('.modal')) return true;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  return true;
}

/**
 * A client-side screen change does what a page load would: the title names the new screen,
 * and focus moves to its heading so keyboard and screen reader users start there. The first
 * load leaves focus to the browser. Focus stays put when the student submitted a search (the
 * results are announced instead), and dialogs and the viewer keep managing their own focus.
 */
export function useScreenChange(screen: string) {
  const previous = useRef(screen);
  const pending = useRef(false);
  useLayoutEffect(() => {
    document.title = screenTitle(screen);
    if (previous.current === screen) return;
    previous.current = screen;
    pending.current = false;
    if (screen === 'home') return;
    if (document.activeElement?.closest('form[role="search"], .modal, .preview-panel')) return;
    pending.current = true;
    if (focusHeading()) return;
    // A lazily loaded screen, such as a policy page, adds its heading a moment later.
    const main = document.getElementById('main');
    if (!main) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [screen]);
  useEffect(() => {
    // A new screen starts at its heading instead of inheriting a long Settings scroll.
    window.scrollTo(0, 0);
    // A closing dialog returns focus to the page after the heading was focused; take it back,
    // but never from something the student focused since.
    if (!pending.current) return;
    pending.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active.id === 'main') focusHeading();
  }, [screen]);
}
