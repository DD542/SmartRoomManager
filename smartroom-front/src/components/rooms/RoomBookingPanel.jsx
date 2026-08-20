import { CalendarPlus, Clock, Map, Zap } from 'lucide-react';
import { fmtDateShort, fmtTime } from '../../utils/dates';
import { openingLabel } from '../../utils/openingRules';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Skeleton } from '../ui/States';

/** U-17 — panneau latéral : prochain créneau libre et accès à la réservation. */
export function RoomBookingPanel({ room, nextSlot, onBook }) {
  const unavailable = room.status === 'maintenance';

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader title="Réserver" icon={CalendarPlus} />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="flex items-center gap-1.5 text-xs text-accent">
            <Zap size={12} aria-hidden="true" />
            Prochain créneau libre
          </p>
          {nextSlot.isLoading && <Skeleton rounded="rounded" className="mt-2 h-4 w-32" />}
          {nextSlot.isSuccess && nextSlot.data && (
            <p className="mt-1 text-sm text-content">
              <span className="capitalize">{fmtDateShort(nextSlot.data.start)}</span>
              <span className="ml-2 font-mono">
                {fmtTime(nextSlot.data.start)} - {fmtTime(nextSlot.data.end)}
              </span>
            </p>
          )}
          {nextSlot.isSuccess && !nextSlot.data && (
            <p className="mt-1 text-xs text-content-muted">
              Aucun créneau libre aujourd’hui, essayez un autre jour.
            </p>
          )}
        </div>

        <p className="flex items-center gap-1.5 text-xs text-content-muted">
          <Clock size={12} aria-hidden="true" />
          {openingLabel(room.rules)}
        </p>

        <Button fullWidth icon={CalendarPlus} disabled={unavailable} onClick={onBook}>
          {unavailable ? 'Salle indisponible' : 'Réserver cette salle'}
        </Button>
        <Button variant="secondary" fullWidth icon={Map} to="/app/plan">
          Voir sur le plan
        </Button>
      </div>
    </Card>
  );
}
