import { cn } from '../../utils/cn';

/**
 * Jauge d'occupation compacte pour les cellules de tableau.
 *
 * L'en-tête de colonne porte déjà le libellé du critère : seule la valeur est
 * répétée par ligne, et l'étiquette accessible nomme la ressource mesurée.
 */
export function CompactGauge({ rate = 0, label, className }) {
  const percent = Math.round(rate * 100);
  const tone = percent >= 75 ? 'bg-danger' : percent >= 55 ? 'bg-warning' : 'bg-success';

  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${percent}%` }} />
      </span>
      <span className="font-mono text-xs text-content-muted">{percent} %</span>
    </span>
  );
}
