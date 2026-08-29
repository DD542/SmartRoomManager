import { useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Badge';
import { Button } from '../ui/Button';
import { BottomSheet } from '../ui/Modal';

/**
 * Un sélecteur de filtre, dans la forme que lui donne son enveloppe.
 *
 * Compact dans la barre du bureau, pleine largeur et haut de 44 px dans la
 * feuille : c'est le même filtre, pas deux composants.
 */
function Selecteur({ filter, pleineLargeur = false }) {
  return (
    <label className={cn('inline-flex items-center', pleineLargeur && 'w-full flex-col items-stretch gap-1')}>
      <span className={pleineLargeur ? 'text-xs text-content-muted' : 'sr-only'}>{filter.label}</span>
      <select
        value={filter.value ?? ''}
        onChange={(event) => filter.onChange(event.target.value || null)}
        className={cn(
          'rounded-lg border border-line bg-surface-raised px-2.5 text-xs text-content focus:border-accent focus:outline-none',
          pleineLargeur ? 'h-11 w-full text-sm' : 'h-8',
        )}
      >
        <option value="">{filter.label}</option>
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Barre de filtres des écrans de liste.
 *
 * Au bureau : une rangée de sélecteurs compacts, les filtres actifs rappelés
 * en chips supprimables, une remise à zéro.
 *
 * Sous 768 px : un seul bouton, et les sélecteurs dans une feuille. Six
 * filtres en `flex-wrap` faisaient six lignes avant la moindre donnée — on
 * défilait pour atteindre la liste qu'on venait filtrer. Les chips actifs,
 * eux, restent visibles : ce qui filtre la vue doit se lire sans ouvrir quoi
 * que ce soit.
 */
export function FilterBar({ filters = [], active = [], onReset, className, children }) {
  const isMobile = useIsMobile();
  const [ouverte, setOuverte] = useState(false);

  const chips = active.length > 0 && (
    <span className="flex flex-wrap items-center gap-1.5">
      {active.map((item) => (
        <Chip key={item.key} label={item.label} onRemove={item.remove} tone="accent" />
      ))}
    </span>
  );

  if (isMobile) {
    return (
      <>
        <Card className={cn('flex flex-wrap items-center gap-2 p-3', className)}>
          <Button
            variant="secondary"
            size="sm"
            icon={SlidersHorizontal}
            onClick={() => setOuverte(true)}
            aria-haspopup="dialog"
            aria-expanded={ouverte}
          >
            Filtres{active.length > 0 ? ` (${active.length})` : ''}
          </Button>
          {chips}
        </Card>

        <BottomSheet
          open={ouverte}
          onClose={() => setOuverte(false)}
          title="Filtres"
          footer={
            <div className="flex items-center justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onReset}>
                Réinitialiser
              </Button>
              <Button size="sm" onClick={() => setOuverte(false)}>
                Voir les résultats
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {filters.map((filter) => (
              <Selecteur key={filter.id} filter={filter} pleineLargeur />
            ))}
            {children}
          </div>
        </BottomSheet>
      </>
    );
  }

  return (
    <Card className={cn('flex flex-wrap items-center gap-2 p-3', className)}>
      <span className="flex items-center gap-1.5 pr-1 text-xs uppercase tracking-wide text-content-muted">
        <SlidersHorizontal size={13} aria-hidden="true" />
        Filtres
      </span>

      {filters.map((filter) => (
        <Selecteur key={filter.id} filter={filter} />
      ))}

      {children}
      {chips}

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
