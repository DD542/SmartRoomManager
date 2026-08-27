import { useState } from 'react';
import { ChevronDown, DoorOpen, Map, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { plural } from '../../../utils/format';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';

/**
 * Étages d'un bâtiment, et les salles qu'ils portent.
 *
 * Les niveaux se déplient parce que la question posée change selon le moment :
 * « combien d'étages » se lit d'un coup d'œil sur la liste repliée, « quelles
 * salles au deuxième » demande d'en ouvrir un seul. Tout déplier d'emblée
 * répondrait à la seconde question en noyant la première.
 *
 * Chaque salle affiche si elle porte un plan de localisation : c'est
 * l'information qui manque le plus souvent, et la voir en liste évite d'ouvrir
 * trente fiches pour trouver les trois qui n'en ont pas.
 */
export function FloorAccordion({
  floors = [],
  onAddFloor,
  onRenameFloor,
  onDeleteFloor,
  onOpenRoom,
  onOpenPlan,
  busy = false,
}) {
  const [ouvert, setOuvert] = useState(() => new Set());

  const basculer = (id) =>
    setOuvert((courant) => {
      const suivant = new Set(courant);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {floors.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-content-faint">
          Aucun étage. Une salle se rattache à un niveau : ajoutez-en un avant de créer des
          salles ici.
        </p>
      )}

      {floors.map((etage) => {
        const deplie = ouvert.has(etage.id);
        return (
          <div key={etage.id} className="rounded-xl border border-line bg-surface-raised">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => basculer(etage.id)}
                aria-expanded={deplie}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className={cn(
                    'shrink-0 text-content-muted transition',
                    deplie && 'rotate-180',
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-content">{etage.label}</span>
                  <span className="block text-[11px] text-content-muted">
                    Niveau {etage.level} · {plural(etage.rooms?.length ?? 0, 'salle')}
                  </span>
                </span>
              </button>

              {/* Le plan de l'étage et la position de ses salles : ce que les
                  utilisateurs voient sur leur écran de plan. */}
              <IconButton
                icon={Map}
                label={`Plan de ${etage.label}`}
                onClick={() => onOpenPlan(etage)}
              />
              <IconButton
                icon={Pencil}
                label={`Renommer ${etage.label}`}
                onClick={() => onRenameFloor(etage)}
              />
              <IconButton
                icon={Trash2}
                label={`Supprimer ${etage.label}`}
                disabled={busy}
                onClick={() => onDeleteFloor(etage)}
              />
            </div>

            {deplie && (
              <ul className="flex flex-col gap-1.5 border-t border-line p-2.5">
                {(etage.rooms ?? []).length === 0 && (
                  <li className="px-1 py-2 text-xs text-content-faint">
                    Aucune salle à ce niveau.
                  </li>
                )}
                {(etage.rooms ?? []).map((salle) => (
                  <li key={salle.id}>
                    <button
                      type="button"
                      onClick={() => onOpenRoom(salle)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface"
                    >
                      <DoorOpen size={14} aria-hidden="true" className="text-content-muted" />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {salle.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-content-muted">
                        {salle.capacity} pl.
                      </span>
                      {salle.locationPlanUrl ? (
                        <Badge tone="success" dot>
                          Plan
                        </Badge>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-content-faint">
                          <MapPin size={11} aria-hidden="true" />
                          sans plan
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <Button variant="secondary" size="sm" icon={Plus} className="w-fit" onClick={onAddFloor}>
        Ajouter un étage
      </Button>
    </div>
  );
}
