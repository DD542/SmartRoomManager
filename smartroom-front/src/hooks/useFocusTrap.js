import { useEffect, useRef } from 'react';
import { declarerSurfaceBloquante } from './useSurfaceBloquante';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Piège le focus dans une surface modale et restitue le focus à l'élément
 * déclencheur en sortie. Échap est délégué à `onEscape`.
 */
export function useFocusTrap(active, onEscape) {
  const ref = useRef(null);
  const previous = useRef(null);

  // La fermeture est jointe par référence, jamais par dépendance.
  //
  // Les appelants la passent en fonction anonyme — `onClose={() => setDraft(null)}`
  // — dont l'identité change à chaque rendu. Avec `onEscape` dans le tableau,
  // l'effet se démontait et se remontait à chaque rendu ; sa remise en place
  // redonne le focus au premier élément focalisable, c'est-à-dire la croix de
  // fermeture. Un champ contrôlé rendant une fois par lettre frappée, la
  // saisie devenait impossible : une lettre, un saut sur la croix.
  //
  // Le piège ne doit se poser qu'à l'ouverture. La référence garde l'accès à
  // la dernière fermeture connue sans lier la vie de l'effet à la sienne.
  const echappement = useRef(onEscape);
  echappement.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    previous.current = document.activeElement;

    const node = ref.current;

    // Recalcules a chaque tabulation, jamais retenus. Une modale change de
    // contenu en cours de vie — un champ qui apparaît, un bouton qui
    // s'active — et une liste figée à l'ouverture laisserait sortir du
    // piège. Elle ne se recalculait jusqu'ici que par l'effet de bord d'un
    // effet remonté à chaque rendu, ce qui n'est plus le cas.
    const focalisables = () =>
      node ? Array.from(node.querySelectorAll(FOCUSABLE)) : [];

    (focalisables()[0] ?? node)?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        echappement.current?.();
        return;
      }
      const focusables = focalisables();
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

    // Une surface bloquante de plus : les panneaux flottants s'effacent le
    // temps qu'elle vive. Le compte est tenu ici parce que toute modale,
    // feuille ou tiroir passe par ce hook — le déclarer composant par composant
    // laisserait le prochain l'oublier.
    const relacher = declarerSurfaceBloquante();

    return () => {
      relacher();
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous.current?.focus?.();
    };
  }, [active]);

  return ref;
}
