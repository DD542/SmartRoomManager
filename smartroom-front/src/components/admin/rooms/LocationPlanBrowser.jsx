import { useState } from 'react';
import { DoorOpen, MapPin } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { plural } from '../../../utils/format';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';

/**
 * Consultation des plans de localisation, bâtiment par bâtiment.
 *
 * Chaque salle porte son propre plan, déposé à sa création : une image
 * annotée qui montre où elle se trouve. Ils n'étaient consultables que fiche
 * par fiche — trente salles, trente allers-retours pour comparer deux niveaux.
 *
 * L'écran ne modifie rien. Le plan d'un étage et le placement des salles se
 * règlent dans l'onglet voisin, celui qui les gouverne ; ici on regarde.
 */
export function LocationPlanBrowser({ floors = [], buildingName = '' }) {
  const salles = floors.flatMap((etage) =>
    (etage.rooms ?? []).map((salle) => ({ ...salle, etage })),
  );
  const [choisieId, setChoisieId] = useState(null);
  const choisie = salles.find((salle) => salle.id === choisieId) ?? salles[0] ?? null;

  if (salles.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={DoorOpen}
          title="Aucune salle"
          description={`${buildingName || 'Ce bâtiment'} ne porte encore aucune salle.`}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader
          title="Salles"
          subtitle={`${plural(salles.length, 'salle')} — ${plural(
            salles.filter((salle) => salle.locationPlanUrl).length,
            'plan déposé',
            'plans déposés',
          )}`}
          icon={DoorOpen}
        />
        <div className="flex flex-col gap-3 px-3 pb-3">
          {floors.map((etage) => (
            <div key={etage.id}>
              <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-content-faint">
                {etage.label}
              </p>
              <ul className="flex flex-col gap-1">
                {(etage.rooms ?? []).map((salle) => {
                  const actif = choisie?.id === salle.id;
                  return (
                    <li key={salle.id}>
                      <button
                        type="button"
                        onClick={() => setChoisieId(salle.id)}
                        aria-current={actif ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition',
                          actif
                            ? 'bg-accent-soft text-content'
                            : 'text-content-muted hover:bg-surface-raised hover:text-content',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{salle.name}</span>
                        {!salle.locationPlanUrl && (
                          <span className="shrink-0 text-[11px] text-content-faint">
                            sans plan
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={choisie?.name ?? 'Plan de localisation'}
          subtitle={
            choisie
              ? `${buildingName} — ${choisie.etage.label} · ${choisie.capacity} places`
              : undefined
          }
          icon={MapPin}
        />
        <div className="px-4 pb-4">
          {choisie?.locationPlanUrl ? (
            <img
              src={choisie.locationPlanUrl}
              alt={`Plan de localisation de ${choisie.name}`}
              className="w-full rounded-xl border border-line bg-surface-raised object-contain"
            />
          ) : (
            <EmptyState
              icon={MapPin}
              title="Aucun plan déposé"
              description={`${choisie?.name ?? 'Cette salle'} n’a pas de plan de localisation. Il se dépose depuis sa fiche, onglet Visuels.`}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
