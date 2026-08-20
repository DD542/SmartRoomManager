import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertOctagon, ArrowLeft, Check } from 'lucide-react';
import { checkSlot, listRoomBookings } from '../../api/bookings';
import { recommendRooms } from '../../api/recommendations';
import { useAsync } from '../../hooks/useAsync';
import { useBooking } from '../../hooks/useBooking';
import { fmtTime, mergeDateAndTime, toDateInput } from '../../utils/dates';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, Callout } from '../../components/ui/Card';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConflictTimeline } from '../../components/bookings/ConflictTimeline';

const matchTone = (score) => (score >= 85 ? 'success' : score >= 70 ? 'warning' : 'default');

/**
 * U-12 — Conflit détecté.
 * Deux sorties possibles : décaler l'horaire dans la même salle, ou changer de
 * salle sur le créneau initial. Les deux options viennent des moteurs métier.
 */
export default function ConflictPage() {
  const navigate = useNavigate();
  const { draft, update, hasDraft, hasRoom, selectRoom } = useBooking();
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    document.title = 'Conflit détecté — SmartRoom Manager';
  }, []);

  const start = mergeDateAndTime(draft.date, draft.startTime);
  const end = mergeDateAndTime(draft.date, draft.endTime);

  const check = useAsync(
    () => checkSlot({ roomId: draft.roomId, start, end }),
    [draft.roomId, draft.date, draft.startTime, draft.endTime],
  );
  const roomBookings = useAsync(
    () => (draft.roomId ? listRoomBookings(draft.roomId) : Promise.resolve([])),
    [draft.roomId],
  );
  const alternativeRooms = useAsync(
    () => recommendRooms({ attendees: Number(draft.attendees), equipmentIds: draft.equipmentIds }),
    [draft.attendees, draft.equipmentIds],
  );

  const options = useMemo(() => {
    const slots = (check.data?.alternatives ?? []).map((slot) => ({
      id: `slot-${slot.start.toISOString()}`,
      kind: 'creneau',
      roomId: draft.roomId,
      room: draft.room,
      label: draft.room?.name,
      detail: `${fmtTime(slot.start)} - ${fmtTime(slot.end)}`,
      score: 98,
      slot,
    }));

    const rooms = (alternativeRooms.data ?? [])
      .filter((entry) => entry.room.id !== draft.roomId && entry.eligible)
      .slice(0, 2)
      .map((entry) => ({
        id: `room-${entry.room.id}`,
        kind: 'salle',
        roomId: entry.room.id,
        room: entry.room,
        label: entry.room.name,
        detail: `${draft.startTime} - ${draft.endTime}`,
        score: entry.score,
        justification: entry.justification,
      }));

    return [...slots.slice(0, 1), ...rooms, ...slots.slice(1, 2)];
  }, [check.data, alternativeRooms.data, draft]);

  if (!hasDraft || !hasRoom) return <Navigate to="/app/reservation/besoin" replace />;

  const apply = () => {
    const option = options.find((item) => item.id === choice);
    if (!option) return;
    if (option.kind === 'creneau') {
      update({
        date: toDateInput(option.slot.start),
        startTime: fmtTime(option.slot.start),
        endTime: fmtTime(option.slot.end),
      });
    } else {
      selectRoom(option.room);
    }
    navigate(`/app/reservation/salles/${option.roomId}`);
  };

  const blocking = (check.data?.conflicts ?? []).filter((conflict) => conflict.blocking);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title="Conflit détecté" subtitle="Ce créneau ne peut pas être réservé en l’état." />

      <AsyncBoundary
        status={check.status}
        error={check.error}
        onRetry={check.reload}
        skeleton={<Skeleton className="h-72 w-full" />}
      >
        <Card tone="danger">
          <CardHeader
            title={blocking[0]?.message ?? 'Le créneau demandé n’est pas disponible.'}
            subtitle={`${draft.room?.name} — ${draft.startTime} - ${draft.endTime}`}
            icon={AlertOctagon}
          />
          <div className="px-4 pb-4">
            <ConflictTimeline
              requested={{ start, end }}
              existing={(roomBookings.data ?? []).filter((booking) =>
                booking.start.startsWith(toDateInput(start)),
              )}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Créneaux et salles alternatifs" />
          <fieldset className="flex flex-col gap-2 px-4 pb-4">
            <legend className="sr-only">Choisir une alternative</legend>
            {options.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                  choice === option.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-raised'
                }`}
              >
                <input
                  type="radio"
                  name="alternative"
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                  className="h-4 w-4 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-content">{option.label}</span>
                  <span className="block font-mono text-xs text-content-muted">{option.detail}</span>
                  {option.justification && (
                    <span className="mt-0.5 block text-xs text-content-muted">{option.justification}</span>
                  )}
                </span>
                <Badge tone={matchTone(option.score)}>{option.score} % compatible</Badge>
              </label>
            ))}

            {options.length === 0 && (
              <Callout tone="warning">
                Aucune alternative automatique sur cette journée : modifiez la date ou l’effectif.
              </Callout>
            )}
          </fieldset>
        </Card>
      </AsyncBoundary>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={ArrowLeft} to={`/app/reservation/salles/${draft.roomId}`}>
          Choisir un autre créneau manuellement
        </Button>
        <Button icon={Check} disabled={!choice} onClick={apply}>
          Réserver cette alternative
        </Button>
      </footer>
    </div>
  );
}
