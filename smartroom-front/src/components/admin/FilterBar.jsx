import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Badge';

/**
 * Barre de filtres des écrans de liste : une série de sélecteurs compacts, les
 * filtres actifs rappelés en chips supprimables, et une remise à zéro.
 */
export function FilterBar({ filters = [], active = [], onReset, className, children }) {
  return (
    <Card className={cn('flex flex-wrap items-center gap-2 p-3', className)}>
      <span className="flex items-center gap-1.5 pr-1 text-xs uppercase tracking-wide text-content-muted">
        <SlidersHorizontal size={13} aria-hidden="true" />
        Filtres
      </span>

      {filters.map((filter) => (
        <label key={filter.id} className="inline-flex items-center">
          <span className="sr-only">{filter.label}</span>
          <select
            value={filter.value ?? ''}
            onChange={(event) => filter.onChange(event.target.value || null)}
            className="h-8 rounded-lg border border-line bg-surface-raised px-2.5 text-xs text-content focus:border-accent focus:outline-none"
          >
            <option value="">{filter.label}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {children}

      {active.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {active.map((item) => (
            <Chip key={item.key} label={item.label} onRemove={item.remove} tone="accent" />
          ))}
        </span>
      )}

      <button
        type="button"
        onClick={onReset}
        className="ml-auto inline-flex items-center gap-1 text-xs text-accent transition hover:text-accent-hover"
      >
        <RotateCcw size={12} aria-hidden="true" />
        Réinitialiser
      </button>
    </Card>
  );
}
