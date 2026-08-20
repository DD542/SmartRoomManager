import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarDays, List, Plus, Search } from 'lucide-react';
import { listBookings } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { NOW, toDate } from '../../utils/dates';
import { normalize } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Badge';
import { SegmentedControl } from '../../components/ui/Tabs';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { Pagination, paginate } from '../../components/ui/Table';
import { PageHeader } from '../../components/layout/PageHeader';
import { BookingTable } from '../../components/bookings/BookingTable';

const PAGE_SIZE = 8;

/** Répartition métier des onglets, calculée à l'horloge de référence. */
function bucketOf(booking) {
  if (booking.status === 'annulee') return 'annulees';
  if (toDate(booking.end) < NOW) return 'passees';
  if (toDate(booking.start) <= NOW && NOW <= toDate(booking.end)) return 'en_cours';
  return 'a_venir';
}

/** U-07 — Mes réservations, vue liste. */
export default function MyBookingsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('a_venir');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = 'Mes réservations — SmartRoom Manager';
  }, []);

  const bookings = useAsync(() => listBookings({ ownerId: user.id }), [user.id]);

  const counts = useMemo(() => {
    const all = bookings.data ?? [];
    return {
      a_venir: all.filter((b) => bucketOf(b) === 'a_venir').length,
      en_cours: all.filter((b) => bucketOf(b) === 'en_cours').length,
      passees: all.filter((b) => bucketOf(b) === 'passees').length,
      annulees: all.filter((b) => bucketOf(b) === 'annulees').length,
    };
  }, [bookings.data]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return (bookings.data ?? [])
      .filter((booking) => bucketOf(booking) === tab)
      .filter((booking) => (q ? normalize(`${booking.title} ${booking.room?.name}`).includes(q) : true));
  }, [bookings.data, tab, query]);

  const paged = paginate(filtered, page, PAGE_SIZE);

  const TABS = [
    { id: 'a_venir', label: 'À venir', count: counts.a_venir },
    { id: 'en_cours', label: 'En cours', count: counts.en_cours },
    { id: 'passees', label: 'Passées', count: counts.passees },
    { id: 'annulees', label: 'Annulées', count: counts.annulees },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mes réservations"
        actions={
          <>
            <SegmentedControl
              label="Mode d’affichage"
              value="liste"
              onChange={(value) => value === 'calendrier' && navigate('/app/reservations/calendrier')}
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

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <Pill
              key={item.id}
              active={tab === item.id}
              count={item.count}
              onClick={() => {
                setTab(item.id);
                setPage(1);
              }}
            >
              {item.label}
            </Pill>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <label htmlFor="recherche-reservations" className="sr-only">
            Rechercher une réservation
          </label>
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
          />
          <input
            id="recherche-reservations"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Rechercher une salle…"
            className="h-9 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
          />
        </div>
      </Card>

      <Card>
        <AsyncBoundary
          status={bookings.status}
          error={bookings.error}
          onRetry={bookings.reload}
          isEmpty={bookings.isSuccess && filtered.length === 0}
          skeleton={
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          }
          empty={
            <EmptyState
              icon={CalendarCheck}
              title="Aucune réservation dans cet onglet"
              description={
                query
                  ? 'Aucun résultat pour cette recherche.'
                  : 'Vos réservations apparaîtront ici dès la première confirmation.'
              }
              action={
                <Button size="sm" to="/app/reservation/besoin">
                  Réserver une salle
                </Button>
              }
            />
          }
        >
          <BookingTable bookings={paged.items} isMobile={isMobile} />
          {paged.pageCount > 1 && (
            <Pagination
              page={paged.page}
              pageCount={paged.pageCount}
              total={paged.total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
              label="réservations"
            />
          )}
        </AsyncBoundary>
      </Card>
    </div>
  );
}
