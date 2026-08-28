import { DoorOpen, MapPin } from 'lucide-react';
import { cn } from '../../utils/cn';
import { plural } from '../../utils/format';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';

/**
 * Plan de localisation d'une salle, côté utilisateur.
 *
 * L'administration consulte ces images depuis « Plans de localisation » : une
 * photo annotée, déposée avec la salle, qui montre où elle se trouve dans le
 * bâtiment. Côté utilisateur, l'écran du plan n'en montrait aucune — il ne
 * connaissait que le plan d'étage, rarement déposé, et retombait sur son
 * schéma indicatif. Les deux écrans montrent désormais la même chose.
 *
 * Le schéma reste le fond de carte tant qu'aucune salle n'est choisie : c'est
 * lui qui sert à choisir.
 */
export function RoomLocationPlan({ room, onBack, children }) {
  if (!room?.locationPlanUrl) return children;

  return (
    <Card>
      <CardHeader
        title={`Plan de localisation — ${room.name}`}
        subtitle={room.floor}
        icon={MapPin}
        action={
          onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Revenir au plan de l’étage
            </Button>
          )
        }
      />
      <div className="px-4 pb-4">
        <img
          src={room.locationPlanUrl}
          alt={`Plan de localisation de ${room.name}`}
          className="w-full rounded-xl border border-line bg-surface-raised object-contain"
        />
      </div>
    </Card>
  );
}

/**
 * Les salles de l'étage, en pastilles.
 *
 * Le schéma ne suffit pas à les atteindre toutes : une salle que
 * l'administration n'a pas encore posée n'y figure pas, et rien d'autre ne
 * permettait alors de l'ouvrir. La liste dit aussi lesquelles n'ont pas de
 * plan déposé, plutôt que de laisser croire à un écran vide.
 */
export function FloorRoomPicker({ rooms = [], selectedId, onSelect }) {
  if (!rooms.length) return null;

  const avecPlan = rooms.filter((salle) => salle.locationPlanUrl).length;

  return (
    <Card>
      <CardHeader
        title="Salles de cet étage"
        subtitle={`${plural(rooms.length, 'salle')} — ${plural(
          avecPlan,
          'plan déposé',
          'plans déposés',
        )}`}
        icon={DoorOpen}
      />
      <ul className="flex flex-wrap gap-1.5 px-4 pb-4">
        {rooms.map((salle) => {
          const actif = salle.id === selectedId;
          return (
            <li key={salle.id}>
              <button
                type="button"
                onClick={() => onSelect?.(salle)}
                aria-current={actif ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition',
                  actif
                    ? 'border-accent/50 bg-accent-soft text-content'
                    : 'border-line bg-surface-raised text-content-muted hover:border-accent/40 hover:text-content',
                )}
              >
                {salle.name}
                {!salle.locationPlanUrl && (
                  <span className="text-[10px] text-content-faint">sans plan</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
