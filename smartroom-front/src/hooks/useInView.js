import { useEffect, useRef, useState } from 'react';

/** Vrai si l'utilisateur a demandé à limiter les animations. */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Signale l'entrée d'un élément dans la fenêtre, une fois.
 *
 * Rend `[ref, vu]`. `vu` passe à vrai quand l'élément approche de la fenêtre
 * et n'en redescend jamais : réanimer au défilement inverse donne un contenu
 * qui clignote, pas une page vivante.
 *
 * Une apparition ratée laisse du contenu invisible — bien pire que pas
 * d'animation du tout. D'où trois précautions :
 *
 *   1. Sans `IntersectionObserver`, tout est vu d'emblée.
 *   2. Sous `prefers-reduced-motion`, tout l'est aussi, sans attendre.
 *   3. Ce qui occupe déjà l'écran au chargement est mesuré tout de suite, sans
 *      attendre la première réponse de l'observateur : le haut de page ne
 *      clignote pas.
 *
 * `rootMargin` négatif en bas : l'élément se révèle une fois franchement
 * entré, et non dès que son premier pixel affleure le bord de l'écran.
 */
export function useInView({ seuil = 0.15, marge = '0px 0px -12% 0px' } = {}) {
  const cible = useRef(null);
  const [vu, setVu] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (vu) return undefined;

    const element = cible.current;
    if (!element || prefersReducedMotion()) {
      setVu(true);
      return undefined;
    }

    // Page non peinte — onglet ouvert en arrière-plan, fenêtre de hauteur
    // nulle : l'observateur ne se déclenchera pas, faute de rendu. Tout est
    // alors montré sans animation. Une page qui reste blanche est un défaut ;
    // une page qui n'a pas glissé n'en est pas un.
    const hauteur = window.innerHeight || document.documentElement.clientHeight;
    if (!hauteur || document.visibilityState === 'hidden') {
      setVu(true);
      return undefined;
    }

    // Déjà à l'écran : inutile de faire un aller-retour par l'observateur, qui
    // répondrait à la frame suivante — le contenu du premier écran doit être
    // là dès la première peinture.
    const cadre = element.getBoundingClientRect();
    if (cadre.top < hauteur && cadre.bottom > 0) {
      setVu(true);
      return undefined;
    }

    const observateur = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((entree) => entree.isIntersecting)) {
          setVu(true);
          observateur.disconnect();
        }
      },
      { threshold: seuil, rootMargin: marge },
    );
    observateur.observe(element);

    return () => observateur.disconnect();
  }, [vu, seuil, marge]);

  return [cible, vu];
}
