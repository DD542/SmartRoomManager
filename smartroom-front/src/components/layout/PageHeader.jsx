import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../utils/cn';

/** En-tête de page : retour éventuel, titre, sous-titre, actions à droite. */
export function PageHeader({ title, subtitle, backTo, backLabel = 'Retour', actions, className, children }) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {backTo && (
        <Link
          to={backTo}
          // Un seul endroit pour tous les retours de l'application : « Retour
          // à mes réservations », « Retour à la liste », et les suivants.
          // Relâché à partir de `lg`, où la souris vise seize pixels sans peine.
          className="-my-2 inline-flex min-h-[44px] w-fit items-center gap-1 py-2 text-xs text-content-muted transition hover:text-content lg:my-0 lg:min-h-0 lg:py-0"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-content">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-content-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
