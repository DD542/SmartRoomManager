import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

const TONES = {
  default: 'border-line bg-surface-raised text-content-muted',
  accent: 'border-accent/40 bg-accent-soft text-accent-bright',
  success: 'border-success/40 bg-success-soft text-success',
  warning: 'border-warning/40 bg-warning-soft text-warning',
  danger: 'border-danger/40 bg-danger-soft text-danger',
  muted: 'border-line bg-surface text-content-faint',
};

/**
 * Un statut ne repose jamais sur la seule couleur : la pastille est doublée
 * d'un libellé textuel, conformément au critère WCAG 1.4.1.
 */
export function Badge({ tone = 'default', dot = false, icon: Icon, className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium',
        TONES[tone] ?? TONES.default,
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Bouton-pastille des filtres et des onglets compacts. */
export function Pill({ active = false, className, children, count, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-accent bg-accent-soft text-content'
          : 'border-line bg-surface text-content-muted hover:border-line-strong hover:text-content',
        className,
      )}
      {...props}
    >
      {children}
      {/* Le compteur monte d'un cran sur la pastille active : `content-faint`
          sur le fond `accent-soft`, plus clair que la surface, ne donnait que
          4:1 — sous le seuil AA. Sur les pastilles inactives, le fond reste
          sombre et la teinte faible passe. */}
      {typeof count === 'number' && (
        <span className={active ? 'text-content-muted' : 'text-content-faint'}>({count})</span>
      )}
    </button>
  );
}

/** Chip de filtre actif, supprimable. */
export function Chip({ label, onRemove, icon: Icon, tone = 'default', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
        TONES[tone] ?? TONES.default,
        className,
      )}
    >
      {Icon && <Icon size={12} aria-hidden="true" />}
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Retirer le filtre ${label}`}
          className="rounded p-0.5 text-content-faint transition hover:text-content"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** Chip sélectionnable (équipements requis du formulaire de besoin). */
export function ToggleChip({ active, label, icon: Icon, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
        active
          ? 'border-accent bg-accent-soft text-content'
          : 'border-line bg-surface text-content-muted hover:border-line-strong hover:text-content',
        className,
      )}
    >
      {Icon && <Icon size={13} aria-hidden="true" />}
      {label}
    </button>
  );
}

/** Barre d'occupation des cartes de salle : verte, ambre puis rouge. */
export function OccupancyBar({ rate = 0, className, label = 'Occupation' }) {
  const percent = Math.round(rate * 100);
  const tone = percent >= 75 ? 'bg-danger' : percent >= 55 ? 'bg-warning' : 'bg-success';
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-xs text-content-muted">
        <span>{label}</span>
        <span className="font-mono text-content">{percent} %</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} : ${percent} %`}
      >
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
