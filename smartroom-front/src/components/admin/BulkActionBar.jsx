import { X } from 'lucide-react';
import { Button, IconButton } from '../ui/Button';

/**
 * Barre d'actions groupées, ancrée en bas de l'écran dès qu'une ligne est
 * sélectionnée. Le décompte est explicite : une action groupée doit toujours
 * dire sur combien d'éléments elle porte.
 */
export function BulkActionBar({
  count = 0,
  label = 'élément sélectionné',
  labelPlural,
  actions = [],
  onClear,
  busy = false,
}) {
  if (count === 0) return null;

  return (
    // Collée au bas de la zone de contenu, marge du système comprise : sur un
    // téléphone à barre gestuelle, la rangée d'actions passait sous
    // l'indicateur d'accueil. `w-full` sous 640 px — une barre « au plus juste »
    // y devenait trois lignes centrées, dont on ne savait plus laquelle
    // portait quoi.
    <div
      role="toolbar"
      aria-label="Actions sur la sélection"
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-sticky mx-auto flex w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 sm:w-fit sm:max-w-full"
    >
      <span className="rounded-lg bg-accent px-2 py-1 font-mono text-xs text-ink">{count}</span>
      {/* Le libellé complet est fourni par l'écran : accoler « s » à
          « réservation sélectionné » produirait un accord faux. */}
      <span className="pr-1 text-xs text-content">
        {count > 1 ? (labelPlural ?? `${label}s`) : label}
      </span>

      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.tone === 'danger' ? 'danger' : 'secondary'}
          icon={action.icon}
          disabled={busy}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}

      <IconButton icon={X} label="Annuler la sélection" onClick={onClear} />
    </div>
  );
}
