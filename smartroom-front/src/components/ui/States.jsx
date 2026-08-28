import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

/** Bloc de chargement à la forme du contenu attendu. */
export function Skeleton({ className, rounded = 'rounded-xl' }) {
  return <div className={cn('skeleton', rounded, className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          rounded="rounded"
          className={cn('h-3', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** Squelette de carte, réutilisé par les grilles de salles et de réservations. */
export function SkeletonCard({ className }) {
  return (
    <div className={cn('card-surface p-4', className)}>
      <Skeleton className="mb-3 h-28 w-full" />
      <SkeletonText lines={2} />
    </div>
  );
}

export function Spinner({ label = 'Chargement en cours', className }) {
  return (
    <div role="status" className={cn('flex items-center gap-2 text-sm text-content-muted', className)}>
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** État vide : toujours une explication et, si possible, une action de sortie. */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-raised">
          <Icon size={20} aria-hidden="true" className="text-content-muted" />
        </span>
      )}
      <div>
        <p className="text-sm font-medium text-content">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-content-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** État d'erreur : message de l'API, jamais un « une erreur est survenue » muet. */
export function ErrorState({ error, onRetry, title = 'Impossible de charger ces données', className }) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-danger/40 bg-danger-soft">
        <AlertTriangle size={20} aria-hidden="true" className="text-danger" />
      </span>
      <div>
        <p className="text-sm font-medium text-content">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-content-muted">
          {error?.message ?? 'Le service ne répond pas pour le moment.'}
        </p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

/**
 * Aiguillage des quatre états d'un écran. Les pages l'utilisent pour ne jamais
 * oublier un cas : chargement, erreur, vide, nominal.
 */
export function AsyncBoundary({
  status,
  error,
  onRetry,
  isEmpty,
  skeleton,
  empty,
  //: Écran d'erreur de remplacement. Certains refus méritent mieux qu'un
  //: message générique : un 404 sur une réservation, par exemple, dit surtout
  //: que le compte connecté n'est pas celui qui l'a créée.
  errorState,
  children,
}) {
  if (status === 'chargement') return skeleton ?? <Spinner className="px-6 py-12" />;
  if (status === 'erreur') return errorState ?? <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) return empty ?? <EmptyState title="Aucun résultat" />;
  return children;
}
