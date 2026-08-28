import { useLocation } from 'react-router-dom';

/**
 * Apparition du contenu à chaque changement d'écran.
 *
 * La clé est le chemin : React remonte donc l'enveloppe à chaque navigation,
 * et l'animation rejoue. Sans elle, une classe posée une fois au montage ne
 * jouerait que sur le premier écran de la session.
 *
 * Deux propriétés seulement — opacité et translation — parce qu'elles sont
 * composées par le processeur graphique : aucun recalcul de mise en page, donc
 * rien qui saccade sur un téléphone d'entrée de gamme. Une animation qui
 * hache vaut moins que pas d'animation.
 *
 * `prefers-reduced-motion` la réduit à 0,01 ms par la règle globale de
 * `index.css` : le contenu apparaît alors sans mouvement, jamais rien de
 * masqué.
 */
export function PageTransition({ children, className }) {
  const { pathname } = useLocation();

  return (
    <div key={pathname} className={className}>
      <div className="animate-fade-in-up">{children}</div>
    </div>
  );
}
