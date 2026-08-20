import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Skeleton } from '../ui/States';

/**
 * Tuile de chiffre clé. La valeur est en monospace, l'unité reste lisible,
 * et la tendance ne s'appuie jamais sur la seule couleur : une flèche l'accompagne.
 */
export function KpiTile({ icon: Icon, value, unit, label, trend, tone = 'default', className }) {
  const Arrow = trend?.direction === 'down' ? TrendingDown : TrendingUp;
  const trendTone =
    trend?.direction === 'down'
      ? 'text-danger'
      : trend?.direction === 'flat'
        ? 'text-content-muted'
        : 'text-success';

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-line bg-surface p-4', className)}>
      {Icon && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
            tone === 'accent' ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-raised',
          )}
        >
          <Icon
            size={16}
            aria-hidden="true"
            className={tone === 'accent' ? 'text-accent' : 'text-content-muted'}
          />
        </span>
      )}
      <div className="min-w-0">
        <p className="flex items-baseline gap-1">
          <span className="font-mono text-xl text-content">{value}</span>
          {unit && <span className="text-xs text-content-muted">{unit}</span>}
          {trend && (
            <span className={cn('ml-1 inline-flex items-center gap-0.5 text-xs', trendTone)}>
              <Arrow size={12} aria-hidden="true" />
              {trend.label}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-content-muted">{label}</p>
      </div>
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <Skeleton className="h-9 w-9" />
      <div className="flex-1">
        <Skeleton rounded="rounded" className="h-5 w-16" />
        <Skeleton rounded="rounded" className="mt-2 h-3 w-24" />
      </div>
    </div>
  );
}
