import { useEffect } from 'react';
import type { CampusRecallModel } from '../app/useCampusRecall';
export function useModalFocus(model: CampusRecallModel) {
  const { firstUse, rename, deleting, setRename, setDeleting } = model;
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('.modal');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    // The opening menu item is removed and autoFocus may already be inside the dialog,
    // so the item's Actions button is the fallback return target.
    const itemId = rename?.id ?? deleting?.id;
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar,.workspace,.mobile-nav,.preview-panel'),
    );
    const wasInert = backgrounds.map((el) => el.inert);
    backgrounds.forEach((el) => (el.inert = true));
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input,textarea,select,[tabindex="0"]',
        ),
      );
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const controls = focusable();
        const first = controls[0];
        const last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      if (e.key === 'Escape') {
        if (rename) setRename(undefined);
        if (deleting) setDeleting(undefined);
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => {
      backgrounds.forEach((el, i) => (el.inert = wasInert[i]));
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', trap, true);
      const actions = Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]'))
        .find((el) => itemId && el.dataset.itemId === itemId)
        ?.querySelector<HTMLElement>('.more');
      const target =
        previous && previous !== document.body && previous.isConnected && !dialog.contains(previous)
          ? previous
          : (actions ?? document.getElementById('main'));
      target?.focus();
    };
  }, [firstUse, !!rename, !!deleting]);
}
