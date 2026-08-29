import { CalendarPlus, Map, Route, X } from 'lucide-react';
import { fmtArea, fmtCapacity, ROOM_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/States';
import { equipmentIcon } from './equipmentIcons';
import { RoomThumb } from './RoomThumb';

const STATUS_TONE = { disponible: 'success', occupee: 'danger', maintenance: 'warning' };

/** U-18 — panneau latéral : détail de la salle sélectionnée sur le plan. */
export function RoomPlanAside({ room, directions = [], onClose }) {
  if (!room) {
    return (
      <Card className="lg:sticky lg:top-4">
        <EmptyState
          icon={Map}
          title="Aucune salle sélectionnée"
          description="Cliquez sur une salle du plan pour afficher son détail et son itinéraire."
        />
      </Card>
    );
  }

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader
        title="Détails de la salle"
        action={<IconButton icon={X} label="Fermer le détail" onClick={onClose} />}
      />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="relative">
          <RoomThumb room={room} className="h-28 w-full rounded-xl" iconSize={24} />
          <span className="absolute left-2 top-2">
            <Badge tone={STATUS_TONE[room.status] ?? 'default'} dot>
              {ROOM_STATUS_LABEL[room.status]}
            </Badge>
          </span>
        </div>

        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-content">{room.name}</h2>
          <span className="text-xs text-content-muted">{room.floor}</span>
        </div>
        <p className="text-xs leading-relaxed text-content-muted">{room.description}</p>

        <div className="flex gap-4 border-y border-line py-2 text-xs text-content">
          <span>{fmtCapacity(room.capacity)} max</span>
          <span>{fmtArea(room.area)}</span>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-content-muted">Équipements</p>
          {/* Colonnes qui se comptent d'après la place disponible, et non
              d'après un point de rupture : ce panneau vit tantôt dans une
              colonne de 320 px, tantôt dans une feuille de 360, tantôt dans
              une feuille de 768. Deux colonnes imposées y coupaient
              « Vidéoprojecteur » en deux. */}
          <ul className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
            {(room.equipment ?? []).map((item) => {
              const Icon = equipmentIcon(item.icon);
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-xs text-content-muted"
                >
                  <Icon size={12} aria-hidden="true" />
                  {item.label}
                </li>
              );
            })}
          </ul>
        </div>

        {directions.length > 0 && (
          <ol className="flex flex-col gap-1.5 border-t border-line pt-3">
            {directions.map((step, index) => (
              <li key={step} className="flex items-center gap-2 text-xs text-content-muted">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised font-mono text-[10px]">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        )}

        <Button fullWidth icon={Route} to={`/app/salles/${room.id}`}>
          Voir l’itinéraire détaillé
        </Button>
        <Button variant="secondary" fullWidth icon={CalendarPlus} to="/app/reservation/besoin">
          Réserver cette salle
        </Button>
      </div>
    </Card>
  );
}
