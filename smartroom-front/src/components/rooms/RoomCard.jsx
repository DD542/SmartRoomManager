import { Link } from 'react-router-dom';
import { Accessibility, MapPin, Sparkles, Users } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtArea, fmtCapacity, ROOM_STATUS_LABEL } from '../../utils/format';
import { Badge, OccupancyBar } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Tooltip } from '../ui/Tooltip';
import { equipmentIcon } from './equipmentIcons';
import { RoomThumb } from './RoomThumb';

const STATUS_TONE = { disponible: 'success', occupee: 'danger', maintenance: 'warning' };

/**
 * « Bâtiment • étage • surface », amputé de ce qui manque.
 *
 * Les trois parties étaient jointes par des séparateurs écrits en dur :
 * une salle servie sans bâtiment ni surface affichait « • • undefined m² ».
 */
const situation = (room) =>
  [room.building?.name, room.floor, room.area == null ? null : fmtArea(room.area)]
    .filter(Boolean)
    .join(' • ');

export function EquipmentIcons({ equipment = [], className }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {equipment.map((item) => {
        const Icon = equipmentIcon(item.icon);
        return (
          <li key={item.id}>
            <Tooltip label={item.label}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface-raised">
                <Icon size={13} aria-hidden="true" className="text-content-muted" />
                <span className="sr-only">{item.label}</span>
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** Carte de salle du catalogue et de l'étape 2 du tunnel. */
export function RoomCard({ room, tight = false, action, to, badge }) {
  const unavailable = room.status === 'maintenance';

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative">
        <RoomThumb room={room} className="h-32 w-full" iconSize={22} />
        <span className="absolute left-2 top-2">
          <Badge tone={STATUS_TONE[room.status] ?? 'default'} dot>
            {badge ?? ROOM_STATUS_LABEL[room.status]}
          </Badge>
        </span>
        <span className="absolute right-2 top-2">
          <Badge tone="default" icon={Users}>
            {room.capacity}
          </Badge>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div>
          <Link
            to={to ?? `/app/salles/${room.id}`}
            // Le titre de la carte est aussi son lien : 84 x 17 px au
            // téléphone, là où c'est le geste le plus naturel pour ouvrir une
            // salle. La zone sensible s'étend sans que le texte bouge.
            className="-my-2 inline-flex min-h-[44px] items-center py-2 text-sm font-semibold text-content transition hover:text-accent lg:my-0 lg:min-h-0 lg:py-0"
          >
            {room.name}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
            <MapPin size={12} aria-hidden="true" />
            {situation(room)}
            {room.accessible && (
              <Tooltip label="Accessible PMR">
                <Accessibility size={12} aria-hidden="true" className="text-content-muted" />
              </Tooltip>
            )}
          </p>
        </div>

        {!tight && <EquipmentIcons equipment={room.equipment ?? []} />}

        <OccupancyBar rate={room.occupancyRate} className="mt-auto" />

        {action ?? (
          <Button
            size="sm"
            fullWidth
            variant={unavailable ? 'secondary' : 'primary'}
            disabled={unavailable}
            to={unavailable ? undefined : (to ?? `/app/salles/${room.id}`)}
          >
            {unavailable ? 'Indisponible' : 'Voir les créneaux'}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Carte mise en avant : la meilleure proposition du moteur de recommandation. */
export function RecommendationCard({ entry, to, action }) {
  const { room, score, justification } = entry;

  return (
    <Card tone="accent" className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <RoomThumb room={room} className="h-28 w-full rounded-lg sm:w-44" iconSize={24} />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent">
            <Sparkles size={13} aria-hidden="true" />
            Recommandé pour vous
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-content">{room.name}</h3>
            <Badge tone="accent">{score} / 100</Badge>
          </div>
          <p className="mt-1 text-xs text-content-muted">
            {[room.building?.name, room.floor, fmtCapacity(room.capacity)]
              .filter(Boolean)
              .join(' • ')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-content-muted">{justification}</p>
          <EquipmentIcons equipment={room.equipment ?? []} className="mt-3" />
        </div>

        <div className="flex shrink-0 flex-col justify-between gap-3 sm:w-44">
          <OccupancyBar rate={room.occupancyRate} />
          {action ?? (
            <Button size="sm" fullWidth to={to ?? `/app/salles/${room.id}`}>
              Voir les créneaux
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
