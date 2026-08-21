import { DoorOpen, MousePointerSquareDashed, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';
import { Switch } from '../../ui/Form';
import { SegmentedControl } from '../../ui/Tabs';
import { DetailRow } from '../DetailPanel';
import { fmtArea, fmtCapacity } from '../../../utils/format';

const ROTATIONS = [
  { value: 0, label: '0°' },
  { value: 90, label: '90°' },
  { value: 180, label: '180°' },
  { value: 270, label: '270°' },
];

/**
 * A-08 — réglages de la salle sélectionnée sur le plan.
 *
 * Rotation et marqueur d'entrée sont enregistrés à chaque changement : ce sont
 * des réglages ponctuels, une barre d'enregistrement serait ici une friction.
 */
export function PlanRoomPanel({ pose, unplaced = [], onRotate, onEntrance, onUnplace, onPlace, busy }) {
  if (!pose) {
    return (
      <Card className="lg:sticky lg:top-4">
        <CardHeader title="Salle sélectionnée" />
        <div className="px-4 pb-4">
          <EmptyState
            icon={MousePointerSquareDashed}
            title="Aucune salle sélectionnée"
            description="Cliquez une salle du plan pour régler sa rotation et son entrée."
          />
        </div>
        <ListeAPlacer rooms={unplaced} onPlace={onPlace} busy={busy} />
      </Card>
    );
  }

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader title={pose.room.name} subtitle={`${pose.room.floor} · ${fmtArea(pose.room.area)}`} />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <DetailRow label="Capacité">{fmtCapacity(pose.room.capacity)}</DetailRow>
        <DetailRow label="Position" mono>
          {Math.round(pose.room.plan.x)} % · {Math.round(pose.room.plan.y)} %
        </DetailRow>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide text-content-muted">
            <RotateCw size={12} aria-hidden="true" />
            Rotation
          </p>
          <SegmentedControl
            label="Rotation de la salle"
            options={ROTATIONS}
            value={pose.rotation}
            onChange={onRotate}
          />
        </div>

        <Switch
          label="Marquer l’entrée"
          description="Trait vert sur le côté par lequel on accède à la salle."
          icon={DoorOpen}
          checked={pose.entrance}
          onChange={() => onEntrance(!pose.entrance)}
        />

        <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={onUnplace}>
          Retirer du plan
        </Button>
      </div>

      <ListeAPlacer rooms={unplaced} onPlace={onPlace} busy={busy} />
    </Card>
  );
}

function ListeAPlacer({ rooms, onPlace, busy }) {
  if (rooms.length === 0) return null;

  return (
    <div className="border-t border-line px-4 py-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
        Salles à placer ({rooms.length})
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {rooms.map((room) => (
          <li key={room.id}>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onPlace(room.id)}
            >
              {room.name}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-content-faint">
        La salle est déposée au centre du plan, puis se déplace au glisser.
      </p>
    </div>
  );
}
