import { cn } from '../../utils/cn';

/**
 * Apparition d'un élément de la page publique : léger glissement vers le haut
 * avec fondu, `delay` échelonnant les éléments d'une même rangée.
 *
 * Animation CSS et non révélation au défilement : une animation ne peut pas
 * laisser un contenu invisible, alors qu'un observateur qui ne répond jamais
 * — onglet en arrière-plan, fenêtre non peinte — le pourrait. La règle globale
 * `prefers-reduced-motion` neutralise durée et délai.
 */
export function Reveal({ as: Tag = 'div', delay = 0, className, style, children, ...props }) {
  return (
    <Tag
      className={cn('animate-fade-in-up', className)}
      style={{ animationDelay: `${delay}ms`, ...style }}
      {...props}
    >
      {children}
    </Tag>
  );
}
