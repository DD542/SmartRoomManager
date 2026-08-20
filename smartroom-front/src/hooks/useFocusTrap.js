import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Piège le focus dans une surface modale et restitue le focus à l'élément
 * déclencheur en sortie. Échap est délégué à `onEscape`.
 */
export function useFocusTrap(active, onEscape) {
  const ref = useRef(null);
  const previous = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    previous.current = document.activeElement;

    const node = ref.current;
    const focusables = node ? Array.from(node.querySelectorAll(FOCUSABLE)) : [];
    (focusables[0] ?? node)?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous.current?.focus?.();
    };
  }, [active, onEscape]);

  return ref;
}
