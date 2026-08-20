import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarDays, List, Plus, X } from 'lucide-react';
import { listBookings } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { NOW, fmtDateLong, fmtTime, isSameDay, toDate, toDateInput } from '../../utils/dates';
import { fmtCapacity, plural } from '../../utils/format';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/Tabs';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { MonthCalendar } from '../../components/bookings/MonthCalendar';
import { BookingStatusBadge } from '../../components/bookings/BookingTable';

/** U-08 — Mes réservations, vue calendrier avec panneau du jour sélectionné. */
export default function MyBookingsCalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(toDateInput(NOW));
  const [selectedDay, setSelectedDay] = useState(toDateInput(NOW));

  useEffect(() => {
    document.title = 'Calendrier de mes réservations — SmartRoom Manager';
  }, []);

  const bookings = useAsync(() => listBookings({ ownerId: user.id }), [user.id]);

  const dayBookings = useMemo(
    () =>
      (bookings.data ?? []).filter((booking) =>
        selectedDay ? isSameDay(toDate(booking.start), toDate(selectedDay)) : false,
      ),
    [bookings.data, selectedDay],
  );

  const monthLabel = format(toDate(anchor), 'MMMM yyyy', { locale: fr });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mes réservations"
        actions={
          <>
            <SegmentedControl
              label="Mode d’affichage"
              value="calendrier"
              onChange={(value) => value === 'liste' && navigate('/app/reservations')}
              options={[
                { value: 'liste', label: 'Liste', icon: List },
                { value: 'calendrier', label: 'Calendrier', icon: CalendarDays },
              ]}
            />
            <Button to="/app/reservation/besoin" icon={Plus}>
              Nouvelle réservation
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <AsyncBoundary
          status={bookings.status}
          error={bookings.error}
          onRetry={bookings.reload}
          skeleton={<Skeleton className="h-[520px] w-full" />}
        >
          <MonthCalendar
            bookings={bookings.data ?? []}
            monthLabel={monthLabel}
            anchorDate={anchor}
            isLoading={bookings.isLoading}
            onSelectDay={(date) => setSelectedDay(toDateInput(date))}
            onNavigate={(date) => setAnchor(toDateInput(date))}
          />
        </AsyncBoundary>

        <Card className="lg:sticky lg:top-4">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-content-muted">
                {selectedDay && isSameDay(toDate(selectedDay), NOW) ? "Aujourd'hui" : 'Journée'}
              </p>
              <h2 className="mt-0.5 text-sm font-semibold capitalize text-content">
                {selectedDay ? fmtDateLong(selectedDay) : 'Aucun jour sélectionné'}
              </h2>
            </div>
            <IconButton icon={X} label="Effacer la sélection" onClick={() => setSelectedDay(null)} />
          </header>

          {dayBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Aucune réservation"
              description="Sélectionnez un autre jour ou créez une réservation."
            />
          ) : (
            <div className="flex flex-col gap-2 p-3">
              <p className="text-xs text-content-muted">
                {plural(dayBookings.length, 'réservation prévue', 'réservations prévues')}
              </p>
              {dayBookings.map((booking) => (
                <Link
                  key={booking.id}
                  to={`/app/reservations/${booking.id}`}
                  className="rounded-xl border border-line bg-surface-raised p-3 transition hover:border-accent/50"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-lg border border-line bg-surface px-2 py-0.5 font-mono text-xs text-content">
                      {fmtTime(booking.start)} - {fmtTime(booking.end)}
                    </span>
                    <BookingStatusBadge status={booking.status} />
                  </span>
                  <span className="mt-2 block text-sm text-content">{booking.room?.name}</span>
                  <span className="block text-xs text-content-muted">{booking.title}</span>
                  <span className="mt-1.5 block text-xs text-content-muted">
                    {fmtCapacity(booking.attendees)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
