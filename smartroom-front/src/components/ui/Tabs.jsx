import { cn } from '../../utils/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Onglets soulignés. Le motif ARIA complet (tablist/tab) est appliqué :
 * flèches gauche/droite pour naviguer au clavier.
 */
export function Tabs({ tabs = [], value, onChange, className, label = 'Onglets' }) {
  const enSelecteur = useMediaQuery('(max-width: 767px)');

  // Sous 768 px, un sélecteur plutôt que des onglets. Cinq onglets y passaient
  // à la ligne sur trois rangées, occupant le tiers de l'écran avant le
  // moindre champ ; et une barre d'onglets qui se replie ne dit plus quelle
  // section suit quelle autre. Le sélecteur, lui, tient sur une ligne et
  // s'ouvre sur la liste complète — c'est le même choix, pris autrement.
  if (enSelecteur) {
    return (
      <div className={cn('border-b border-line pb-3', className)}>
        <label htmlFor="onglet-courant" className="sr-only">
          {label}
        </label>
        <select
          id="onglet-courant"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          className="h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-content focus:border-accent focus:outline-none"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const onKeyDown = (event) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    if (event.key === 'ArrowRight') onChange?.(tabs[(index + 1) % tabs.length].id);
    if (event.key === 'ArrowLeft') onChange?.(tabs[(index - 1 + tabs.length) % tabs.length].id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Les onglets passent à la ligne plutôt que de défiler : un onglet hors
      // du cadre n'est ni visible ni atteignable au premier coup d'œil.
      className={cn('flex flex-wrap gap-x-1 border-b border-line', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(tab.id)}
            className={cn(
              'relative whitespace-nowrap px-3 py-2.5 text-sm transition',
              active ? 'text-content' : 'text-content-muted hover:text-content',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className="ml-1.5 text-xs text-content-faint">{tab.count}</span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}

/** Bascule compacte : Liste / Calendrier, Ce mois / Ce trimestre / Cette année. */
export function SegmentedControl({ options = [], value, onChange, className, label }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-xl border border-line bg-surface p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium transition',
              active ? 'bg-surface-raised text-content' : 'text-content-muted hover:text-content',
            )}
          >
            {option.icon && <option.icon size={13} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
