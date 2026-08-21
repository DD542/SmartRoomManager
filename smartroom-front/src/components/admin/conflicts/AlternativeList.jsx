import { Check, Sparkles } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { fmtCapacity } from '../../../utils/format';

/**
 * A-04 — salles de repli proposées au demandeur débouté.
 *
 * Le score et la phrase de justification viennent du moteur de recommandation,
 * le même que celui du tunnel utilisateur : l'administrateur propose exactement
 * ce que l'application aurait proposé.
 */
export function AlternativeList({ alternatives = [], selectedId, onSelect }) {
  if (alternatives.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface-raised px-3 py-2.5 text-xs text-content-muted">
        Aucune salle de repli disponible sur ce créneau.
      </p>
    );
  }

  // Sans gestionnaire de sélection, la liste est purement informative : les
  // entrées ne doivent alors pas se présenter comme des boutons cliquables.
  const Element = onSelect ? 'button' : 'div';

  return (
    <ul className="flex flex-col gap-2">
      {alternatives.map((entree) => {
        const actif = selectedId === entree.room.id;
        return (
          <li key={entree.room.id}>
            <Element
              {...(onSelect
                ? { type: 'button', onClick: () => onSelect(entree.room.id), 'aria-pressed': actif }
                : {})}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition',
                actif
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-surface-raised',
                onSelect && !actif && 'hover:border-line-strong',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm text-content">
                  {actif ? (
                    <Check size={14} aria-hidden="true" className="text-accent" />
                  ) : (
                    <Sparkles size={14} aria-hidden="true" className="text-content-muted" />
                  )}
                  {entree.room.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-content-muted">
                  {entree.score}/100
                </span>
              </span>
              <span className="mt-1 block text-[11px] text-content-faint">
                {fmtCapacity(entree.room.capacity)} · {entree.justification}
              </span>
            </Element>
          </li>
        );
      })}
    </ul>
  );
}
