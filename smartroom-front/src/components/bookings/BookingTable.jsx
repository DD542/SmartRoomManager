import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { fmtDayMonth, fmtTime } from '../../utils/dates';
import { BOOKING_STATUS_LABEL, fmtCapacity } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Table } from '../ui/Table';
import { StaggerList } from '../ui/StaggerList';
import { RoomThumb } from '../rooms/RoomThumb';

export const STATUS_TONE = {
  confirmee: 'success',
  en_attente: 'warning',
  terminee: 'muted',
  annulee: 'danger',
};

export function BookingStatusBadge({ status }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'default'} dot>
      {BOOKING_STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Vignette de la salle dans la liste des réservations.
 *
 * Même repère que les cartes du catalogue : trois écrans avaient chacun leur
 * `<img>` nu, et chacun rendait un cadre vide dès qu'une salle n'avait pas de
 * photo — sans erreur nulle part.
 */
function Vignette({ salle, taille = 'sm' }) {
  return (
    <RoomThumb
      room={salle}
      iconSize={taille === 'sm' ? 13 : 16}
      className={
        taille === 'sm'
          ? 'h-8 w-10 rounded-md border border-line'
          : 'h-12 w-14 rounded-lg border border-line'
      }
    />
  );
}

const columns = [
  {
    key: 'room',
    label: 'Salle',
    render: (booking) => (
      <span className="flex items-center gap-2.5">
        <Vignette salle={booking.room} />
        <Link
          to={`/app/reservations/${booking.id}`}
          className="text-sm text-content transition hover:text-accent"
        >
          {booking.room?.name}
        </Link>
      </span>
    ),
  },
  { key: 'date', label: 'Date', render: (b) => <span className="font-mono text-xs">{fmtDayMonth(b.start)}</span> },
  {
    key: 'slot',
    label: 'Créneau',
    render: (b) => (
      <span className="font-mono text-xs">
        {fmtTime(b.start)} - {fmtTime(b.end)}
      </span>
    ),
  },
  { key: 'attendees', label: 'Participants', render: (b) => <span className="text-xs">{fmtCapacity(b.attendees)}</span> },
  { key: 'status', label: 'Statut', render: (b) => <BookingStatusBadge status={b.status} /> },
  {
    key: 'code',
    label: 'Code',
    render: (b) => <span className="font-mono text-xs text-content-muted">{b.accessCode ?? '—'}</span>,
  },
  {
    key: 'actions',
    label: 'Actions',
    align: 'right',
    render: (b) => (
      <Link
        to={`/app/reservations/${b.id}`}
        aria-label={`Ouvrir la réservation ${b.title}`}
        className="inline-flex text-content-muted transition hover:text-content"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    ),
  },
];

/** U-07 — tableau des réservations, dégradé en cartes empilées sous 768px. */
export function BookingTable({ bookings = [], isMobile = false }) {
  if (isMobile) {
    return (
      <StaggerList className="flex flex-col gap-2 p-3">
        {bookings.map((booking) => (
          <Link
            key={booking.id}
            to={`/app/reservations/${booking.id}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised p-3"
          >
            <Vignette salle={booking.room} taille="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-content">{booking.room?.name}</span>
              <span className="mt-0.5 block font-mono text-xs text-content-muted">
                {fmtDayMonth(booking.start)} • {fmtTime(booking.start)} - {fmtTime(booking.end)}
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <BookingStatusBadge status={booking.status} />
                {booking.accessCode && (
                  <span className="font-mono text-xs text-content-muted">{booking.accessCode}</span>
                )}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-content-muted" />
          </Link>
        ))}
      </StaggerList>
    );
  }

  return <Table columns={columns} rows={bookings} caption="Liste de mes réservations" />;
}
