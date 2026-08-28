import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import { getRoom } from '../../api/rooms';
import { useAsync } from '../../hooks/useAsync';
import { useAvailability } from '../../hooks/useAvailability';
import { useBooking } from '../../hooks/useBooking';
import { fmtTime, mergeDateAndTime, toDateInput } from '../../utils/dates';
import { fmtCapacity, ROOM_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { EquipmentIcons } from '../../components/rooms/RoomCard';
import { RoomCalendar } from '../../components/bookings/RoomCalendar';
import { SlotPanel } from '../../components/bookings/SlotPanel';

const STATUS_TONE = { disponible: 'success', occupee: 'danger', maintenance: 'warning' };

/**
 * U-04 — Calendrier de disponibilité de la salle, étape 3 du tunnel.
 * La plage chargée suit la vue affichée (jour, semaine, mois, année) et la
 * sélection est vérifiée en direct : règles d'ouverture, conflits, alternatives.
 */
export default function RoomAvailabilityPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { draft, update, hasDraft, selectRoom } = useBooking();
  const [range, setRange] = useState(null);

  const room = useAsync(() => getRoom(roomId), [roomId]);

  useEffect(() => {
    if (room.data) {
      document.title = `${room.data.name} — SmartRoom Manager`;
      if (draft.roomId !== room.data.id) selectRoom(room.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.data]);

  const availability = useAvailability(roomId, range, {
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
  });

  if (!hasDraft) return <Navigate to="/app/reservation/besoin" replace />;

  if (room.isError) {
    return (
      <div className="card-surface">
        <ErrorState error={room.error} onRetry={room.reload} title="Salle introuvable" />
      </div>
    );
  }

  const pickSlot = (start, end) =>
    update({ date: toDateInput(start), startTime: fmtTime(start), endTime: fmtTime(end) });

  return (
    <div className="flex flex-col gap-4">
      {room.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <Card className="flex flex-wrap items-center gap-4 p-3.5">
          <img src={room.data.photos?.[0]} alt="" className="h-14 w-20 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-content">{room.data.name}</h1>
              <Badge tone={STATUS_TONE[room.data.status] ?? 'default'} dot>
                {ROOM_STATUS_LABEL[room.data.status]}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-content-muted">
              <span className="flex items-center gap-1">
                <MapPin size={12} aria-hidden="true" />
                {room.data.building?.name} — {room.data.floor}
              </span>
              <span className="flex items-center gap-1">
                <Users size={12} aria-hidden="true" />
                {fmtCapacity(room.data.capacity)}
              </span>
            </p>
          </div>
          <EquipmentIcons equipment={room.data.equipment ?? []} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {availability.isError ? (
          <div className="card-surface">
            <ErrorState error={availability.error} onRetry={availability.reload} />
          </div>
        ) : (
          <RoomCalendar
            bookings={availability.bookings}
            rules={availability.rules ?? room.data?.rules}
            anchorDate={draft.date}
            selection={{ date: draft.date, startTime: draft.startTime, endTime: draft.endTime }}
            isLoading={availability.isLoading}
            onSelect={pickSlot}
            onRangeChange={setRange}
          />
        )}

        <SlotPanel
          slot={{
            start: mergeDateAndTime(draft.date, draft.startTime),
            end: mergeDateAndTime(draft.date, draft.endTime),
          }}
          rules={availability.rules ?? room.data?.rules}
          checking={availability.checking}
          conflicts={availability.conflicts}
          alternatives={availability.alternatives}
          ruleErrors={availability.ruleErrors}
          ruleWarnings={availability.ruleWarnings}
          canBook={availability.canBook}
          recurring={draft.recurring}
          onPickAlternative={(alternative) => pickSlot(alternative.start, alternative.end)}
          onContinue={() => navigate('/app/reservation/recapitulatif')}
        />
      </div>
    </div>
  );
}
