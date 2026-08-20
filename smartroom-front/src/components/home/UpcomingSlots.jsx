import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { fmtDayMonth, fmtTime, toDate } from '../../utils/dates';
import { BOOKING_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Card, SectionTitle } from '../ui/Card';
import { EmptyState, Skeleton } from '../ui/States';
import { StaggerList } from '../ui/StaggerList';

const TONE = { confirmee: 'success', en_attente: 'warning', annulee: 'danger', terminee: 'muted' };

/** U-01 — les prochains créneaux de l'utilisateur, hors réservation en cours. */
export function UpcomingSlots({ bookings = [], isLoading }) {
  return (
    <Card className="flex h-full flex-col">
      <SectionTitle
        title="Mes prochains créneaux"
        icon={CalendarClock}
        to="/app/reservations"
        className="px-4 py-3"
      />

      {isLoading && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {!isLoading && bookings.length === 0 && (
        <EmptyState
          icon={CalendarClock}
          title="Rien de prévu"
          description="Vos prochaines réservations apparaîtront ici."
        />
      )}

      {!isLoading && bookings.length > 0 && (
        <StaggerList className="flex flex-col gap-2 px-4 pb-4">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              to={`/app/reservations/${booking.id}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5 transition hover:border-line-strong"
            >
              <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-line bg-surface py-1">
                <span className="text-[10px] uppercase text-content-muted">
                  {toDate(booking.start).toLocaleDateString('fr-FR', { weekday: 'short' })}
                </span>
                <span className="font-mono text-sm text-content">
                  {fmtDayMonth(booking.start).slice(0, 2)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">{booking.room?.name}</span>
                <span className="block font-mono text-xs text-content-muted">
                  {fmtTime(booking.start)} - {fmtTime(booking.end)}
                </span>
              </span>
              <Badge tone={TONE[booking.status] ?? 'default'} dot>
                {BOOKING_STATUS_LABEL[booking.status]}
              </Badge>
            </Link>
          ))}
        </StaggerList>
      )}
    </Card>
  );
}
