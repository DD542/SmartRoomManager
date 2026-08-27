import { useInView } from '../../hooks/useInView';
import { cn } from '../../utils/cn';

/**
 * Apparition d'un élément de la page publique : glissement vers le haut avec
 * fondu, déclenché à l'entrée dans la fenêtre. `delay` échelonne les éléments
 * d'une même rangée.
 *
 * L'animation se jouait auparavant au montage. Sur un écran d'accueil qui fait
 * six fois la hauteur de la fenêtre, tout se jouait donc pendant que le
 * visiteur regardait le premier bandeau : arrivé aux sections suivantes, il ne
 * restait rien à voir. C'est l'entrée dans le champ qui déclenche, désormais.
 *
 * Le mouvement reste tenu à `opacity` et `transform` : ce sont les deux seules
 * propriétés que le compositeur anime sans repasser par la mise en page, et
 * c'est ce qui tient soixante images par seconde sur un téléphone.
 */
export function Reveal({ as: Tag = 'div', delay = 0, className, style, children, ...props }) {
  const [cible, vu] = useInView();

  return (
    <Tag
      ref={cible}
      className={cn('reveal', className)}
      data-visible={vu ? 'true' : 'false'}
      // Le délai ne s'applique qu'à l'aller : au retour — cas qui ne se
      // produit pas ici, l'apparition étant définitive — il ferait traîner.
      style={{ transitionDelay: vu ? `${delay}ms` : '0ms', ...style }}
      {...props}
    >
      {children}
    </Tag>
  );
}
