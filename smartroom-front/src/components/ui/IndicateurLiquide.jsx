import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Bulle de verre qui glisse sous l'élément actif d'une navigation.
 *
 * Elle repère l'élément par `[aria-current="page"]` — ce que `NavLink` pose
 * de lui-même — ou par le sélecteur fourni, et se recale à chaque changement
 * d'écran comme à chaque redimensionnement du conteneur. Le trajet et
 * l'étirement en goutte sont décrits par `.bulle-liquide` dans `index.css` :
 * ici, on ne fait que mesurer.
 *
 * Le conteneur doit être positionné (`relative`) ; ses éléments passent
 * au-dessus de la bulle par `relative z-[1]`.
 *
 * Aucun élément actif — un écran hors navigation — et la bulle s'efface au
 * lieu de rester sur l'onglet quitté.
 */
export function IndicateurLiquide({ conteneur, selecteur = '[aria-current="page"]', className }) {
  const { pathname } = useLocation();
  const [cadre, setCadre] = useState(null);
  const [mouvement, setMouvement] = useState(false);
  const precedent = useRef(null);

  useLayoutEffect(() => {
    const parent = conteneur.current;
    if (!parent) return undefined;

    const mesurer = () => {
      const actif = parent.querySelector(selecteur);
      if (!actif || actif.offsetParent === null) {
        setCadre(null);
        return;
      }
      // Rectangles et non `offsetLeft` : l'élément actif est souvent enveloppé
      // (infobulle, élément de liste positionné), et son `offsetParent`
      // n'est alors plus le conteneur de la bulle.
      const boite = parent.getBoundingClientRect();
      const cible = actif.getBoundingClientRect();
      const suivant = {
        x: cible.left - boite.left - parent.clientLeft + parent.scrollLeft,
        y: cible.top - boite.top - parent.clientTop + parent.scrollTop,
        largeur: cible.width,
        hauteur: cible.height,
      };
      const avant = precedent.current;
      if (avant && (avant.x !== suivant.x || avant.y !== suivant.y)) {
        // Rejoue l'étirement : retirer puis reposer l'attribut au cadre
        // suivant relance l'animation CSS.
        setMouvement(false);
        requestAnimationFrame(() => setMouvement(true));
      }
      precedent.current = suivant;
      setCadre(suivant);
    };

    mesurer();
    // Les entrées arrivent en cascade, translatées : mesurées pendant leur
    // animation, elles placeraient la bulle à côté. On se recale à la fin.
    parent.addEventListener('animationend', mesurer);
    const observateur =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mesurer);
    observateur?.observe(parent);
    return () => {
      parent.removeEventListener('animationend', mesurer);
      observateur?.disconnect();
    };
  }, [conteneur, selecteur, pathname]);

  return (
    <span
      aria-hidden="true"
      data-mouvement={mouvement || undefined}
      className={`bulle-liquide left-0 top-0 ${className ?? ''}`}
      style={
        cadre
          ? {
              width: cadre.largeur,
              height: cadre.hauteur,
              transform: `translate(${cadre.x}px, ${cadre.y}px)`,
              opacity: 1,
            }
          : { opacity: 0 }
      }
    />
  );
}
