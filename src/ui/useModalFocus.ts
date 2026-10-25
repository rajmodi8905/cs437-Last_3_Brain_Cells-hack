import { useEffect } from 'react';
import type { CampusRecallModel } from '../app/useCampusRecall';
export function useModalFocus(model: CampusRecallModel) {
  const { firstUse, rename, deleting, setRename, setDeleting } = model;
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('.modal');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar,.workspace,.mobile-nav,.preview-panel'),
    );
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
      backgrounds.forEach((el) => (el.inert = false));
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', trap, true);
      previous?.focus();
    };
  }, [firstUse, !!rename, !!deleting]);
}
