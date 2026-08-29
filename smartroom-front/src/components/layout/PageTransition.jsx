import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Apparition du contenu à chaque changement d'écran.
 *
 * L'animation est **rejouée**, pas remontée. La première version portait une
 * `key` sur le chemin : React remontait alors tout le sous-arbre à chaque
 * navigation — y compris les mises en page imbriquées et l'état qu'elles
 * tiennent. Le tunnel de réservation monte son brouillon dans `WizardLayout` :
 * il repartait vide à chaque étape, l'écran suivant ne trouvait plus de besoin
 * exprimé et renvoyait à la première étape. Plus aucune réservation n'aboutissait.
 *
 * Une animation est une affaire de présentation. Elle ne doit rien coûter à
 * l'arbre des composants : `getAnimations()` la relance sur place.
 *
 * Deux propriétés seulement — opacité et translation — parce qu'elles sont
 * composées par le processeur graphique : aucun recalcul de mise en page, donc
 * rien qui saccade sur un téléphone d'entrée de gamme.
 *
 * `prefers-reduced-motion` la réduit à 0,01 ms par la règle globale de
 * `index.css` : le contenu apparaît alors sans mouvement, jamais rien de
 * masqué.
 */
export function PageTransition({ children, className }) {
  const { pathname } = useLocation();
  const cible = useRef(null);

  useEffect(() => {
    // `getAnimations` manque à jsdom et aux navigateurs anciens : sans lui,
    // l'écran s'affiche simplement sans rejouer l'apparition. Une animation
    // absente n'est pas un défaut ; du contenu invisible en serait un.
    cible.current?.getAnimations?.().forEach((animation) => {
      animation.cancel();
      animation.play();
    });
  }, [pathname]);

  return (
    <div className={className}>
      <div ref={cible} className="animate-fade-in-up">
        {children}
      </div>
    </div>
  );
}
