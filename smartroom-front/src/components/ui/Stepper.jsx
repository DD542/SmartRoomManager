import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Stepper horizontal du tunnel de réservation.
 * Les étapes franchies sont cliquables, les suivantes sont désactivées.
 */
export function Stepper({ steps = [], current = 1, onGoTo, className, compact = false }) {
  return (
    <nav aria-label="Étapes de la réservation" className={cn('w-full', className)}>
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const position = index + 1;
          const done = position < current;
          const active = position === current;
          const reachable = done && typeof onGoTo === 'function';

          return (
            <li key={step.id} className={cn('flex items-center', index < steps.length - 1 && 'flex-1')}>
              <button
                type="button"
                disabled={!reachable}
                onClick={reachable ? () => onGoTo(step, position) : undefined}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-1.5 transition',
                  reachable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition',
                    done && 'border-success bg-success-soft text-success',
                    active && 'border-accent bg-accent text-ink',
                    !done && !active && 'border-line bg-surface text-content-faint',
                  )}
                >
                  {done ? <Check size={14} aria-hidden="true" /> : position}
                </span>
                {!compact && (
                  <span
                    className={cn(
                      'text-[11px] uppercase tracking-wide',
                      active ? 'text-content' : 'text-content-muted',
                    )}
                  >
                    {step.label}
                  </span>
                )}
                <span className="sr-only">
                  {done ? 'Étape terminée' : active ? 'Étape en cours' : 'Étape à venir'}
                </span>
              </button>

              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mx-2 h-px flex-1 transition',
                    position < current ? 'bg-success/60' : 'bg-line',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Barre de progression simple, utilisée par les formulaires longs. */
export function ProgressBar({ value = 0, max = 100, label, className, tone = 'accent' }) {
  const percent = Math.round((value / max) * 100);
  const tones = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning' };
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && <span className="text-xs text-content-muted">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progression'}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div className={cn('h-full transition-all', tones[tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Fil vertical d'événements : historique d'une réservation, flux de validation. */
export function Timeline({ items = [], className }) {
  return (
    <ol className={cn('flex flex-col gap-4', className)}>
      {items.map((item, index) => (
        <li key={item.id ?? index} className="relative flex gap-3 pl-1">
          <span className="flex flex-col items-center">
            <span
              className={cn(
                'mt-1 h-2.5 w-2.5 rounded-full border-2',
                item.tone === 'success' && 'border-success bg-success',
                item.tone === 'accent' && 'border-accent bg-accent',
                item.tone === 'danger' && 'border-danger bg-danger',
                !item.tone && 'border-line-strong bg-surface',
              )}
              aria-hidden="true"
            />
            {index < items.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" />}
          </span>
          <div className="pb-1">
            <p className="text-sm text-content">{item.label}</p>
            {item.at && <p className="font-mono text-xs text-content-muted">{item.at}</p>}
            {item.description && <p className="mt-0.5 text-xs text-content-muted">{item.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
