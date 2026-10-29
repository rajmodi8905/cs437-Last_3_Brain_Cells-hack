import { useEffect, type RefObject } from 'react';
// Matches the responsive.css breakpoint where the preview panel covers the whole screen.
const FULL_SCREEN = '(max-width: 640px)';
export function useViewerFocus(
  itemId: string,
  panel: RefObject<HTMLElement | null>,
  initial: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const viewer = panel.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = window.matchMedia?.(FULL_SCREEN);
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>('.skip-link,.sidebar,.workspace,.mobile-nav'),
    );
    const wasInert = backgrounds.map((el) => el.inert);
    const sync = () => {
      const covers = !!overlay?.matches;
      backgrounds.forEach((el, i) => (el.inert = covers || wasInert[i]));
      if (covers && !viewer?.contains(document.activeElement)) initial.current?.focus();
    };
    sync();
    overlay?.addEventListener('change', sync);
    return () => {
      overlay?.removeEventListener('change', sync);
      backgrounds.forEach((el, i) => (el.inert = wasInert[i]));
      // Leave focus alone when the user moved it elsewhere, such as clicking another row.
      const active = document.activeElement;
      if (active && active !== document.body && !viewer?.contains(active)) return;
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]'))
        .find((el) => el.dataset.itemId === itemId)
        ?.querySelector<HTMLElement>('.item-open');
      const target = opener?.isConnected && !viewer?.contains(opener) ? opener : row;
      target?.focus();
    };
  }, [itemId, panel, initial]);
}
