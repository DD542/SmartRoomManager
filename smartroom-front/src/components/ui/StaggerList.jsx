import { Children } from 'react';
import { cn } from '../../utils/cn';

/**
 * Apparition en cascade : 40 ms d'écart, plafonnés à 12 éléments pour que les
 * longues listes ne traînent pas. L'animation est neutralisée par la règle
 * globale `prefers-reduced-motion`.
 */
export function StaggerList({ as: Tag = 'div', step = 40, max = 12, className, children, ...props }) {
  return (
    <Tag className={className} {...props}>
      {Children.map(children, (child, index) =>
        child ? (
          <div
            className="animate-fade-in-up"
            style={{ animationDelay: `${Math.min(index, max) * step}ms` }}
          >
            {child}
          </div>
        ) : null,
      )}
    </Tag>
  );
}

/** Variante en grille, pour les catalogues de salles. */
export function StaggerGrid({ className, children, ...props }) {
  return (
    <StaggerList className={cn('grid gap-3', className)} {...props}>
      {children}
    </StaggerList>
  );
}
