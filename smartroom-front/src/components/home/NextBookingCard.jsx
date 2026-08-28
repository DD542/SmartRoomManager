import { CalendarDays, Clock, MapPin, Pencil, Route, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmtCountdown, fmtDateLong, fmtTime, isSameDay, NOW, toDate } from '../../utils/dates';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { AccessCode } from '../ui/AccessCode';
import { EmptyState, Skeleton } from '../ui/States';

/** U-01 — prochaine réservation, compte à rebours et actions immédiates. */
export function NextBookingCard({ booking, isLoading }) {
  if (isLoading) {
    return (
      <Card className="p-4">
        <Skeleton rounded="rounded" className="h-4 w-40" />
        <Skeleton className="mt-4 h-24 w-full" />
      </Card>
    );
  }

  if (!booking) {
    return (
      <Card>
        <CardHeader title="Prochaine réservation" icon={CalendarDays} />
        <EmptyState
          icon={CalendarDays}
          title="Aucune réservation à venir"
          description="Décrivez votre besoin, le système vous proposera la salle la plus adaptée."
          action={
            <Button size="sm" to="/app/reservation/besoin">
              Réserver une salle
            </Button>
          }
        />
      </Card>
    );
  }

  const start = toDate(booking.start);
  const dayLabel = isSameDay(start, NOW) ? "Aujourd'hui" : fmtDateLong(start);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Prochaine réservation"
        icon={CalendarDays}
        action={
          <Badge tone="accent" icon={Clock}>
            {fmtCountdown(booking.start, booking.end)}
          </Badge>
        }
      />

      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link
            to={`/app/reservations/${booking.id}`}
            className="text-lg font-semibold text-content transition hover:text-accent"
          >
            {booking.room?.name}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-content-muted">
            <MapPin size={13} aria-hidden="true" />
            {booking.room?.building?.name ?? 'Bâtiment'} — {booking.room?.floor}
          </p>

          <dl className="mt-4 flex gap-6 border-t border-line pt-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-content-muted">Date</dt>
              <dd className="mt-0.5 text-sm text-content">{dayLabel}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-content-muted">Horaire</dt>
              <dd className="mt-0.5 font-mono text-sm text-content">
                {fmtTime(booking.start)} - {fmtTime(booking.end)}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <AccessCode code={booking.accessCode} masked size="sm" />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Button variant="secondary" size="sm" icon={Route} to="/app/plan">
            Voir l’itinéraire
          </Button>
          <Button variant="secondary" size="sm" icon={Pencil} to={`/app/reservations/${booking.id}/modifier`}>
            Modifier
          </Button>
          <Button variant="danger" size="sm" icon={XCircle} to={`/app/reservations/${booking.id}?annuler=1`}>
            Annuler
          </Button>
        </div>
      </div>
    </Card>
  );
}
