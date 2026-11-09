import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Skeleton } from '../ui/States';
import { TEINTES } from '../ui/teintes';

/**
 * Tuile de chiffre clé. La valeur est en monospace, l'unité reste lisible,
 * et la tendance ne s'appuie jamais sur la seule couleur : une flèche l'accompagne.
 */
export function KpiTile({ icon: Icon, value, unit, label, trend, tone = 'default', teinte, className }) {
  const Arrow = trend?.direction === 'down' ? TrendingDown : TrendingUp;
  // La flèche suit toujours le sens réel de la variation ; la couleur suit son
  // interprétation. Les deux divergent quand baisser est une bonne nouvelle
  // (taux de no-show), d'où le `tone` facultatif porté par la tendance.
  const TONES = { good: 'text-success', bad: 'text-danger', neutral: 'text-content-muted' };
  const trendTone =
    TONES[trend?.tone] ??
    (trend?.direction === 'down'
      ? 'text-danger'
      : trend?.direction === 'flat'
        ? 'text-content-muted'
        : 'text-success');

  return (
    <div className={cn('flex items-center gap-3.5 rounded-3xl border border-line/70 bg-surface/75 p-4 shadow-carte backdrop-blur-xl transition-transform duration-500 ease-ressort hover:-translate-y-0.5', className)}>
      {Icon && (
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            TEINTES[teinte]?.pastille ??
              (tone === 'accent' ? 'bg-accent text-ink' : 'bg-content/[0.06] text-content'),
          )}
        >
          <Icon
            size={16}
            aria-hidden="true"
            className="text-current"
          />
        </span>
      )}
      <div className="min-w-0">
        <p className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-semibold tracking-tight text-content tabular-nums">{value}</span>
          {unit && <span className="text-xs text-content-muted">{unit}</span>}
          {trend && (
            <span className={cn('ml-1 inline-flex items-center gap-0.5 text-xs', trendTone)}>
              <Arrow size={12} aria-hidden="true" />
              {trend.label}
            </span>
          )}
        </p>
        {/* Pas de `truncate` : le libellé porte le sens du chiffre, et
            « Occupation moyenne des salles expl… » n'en dit plus rien. Il
            passe à la ligne, la tuile s'étire, et la grille garde des
            hauteurs égales par rangée. */}
        <p className="mt-0.5 text-xs text-content-muted">{label}</p>
      </div>
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line/70 bg-surface/80 shadow-carte p-4">
      <Skeleton className="h-9 w-9" />
      <div className="flex-1">
        <Skeleton rounded="rounded" className="h-5 w-16" />
        <Skeleton rounded="rounded" className="mt-2 h-3 w-24" />
      </div>
    </div>
  );
}
