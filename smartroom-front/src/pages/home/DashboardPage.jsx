import { useEffect } from 'react';
import { CalendarCheck, Clock, Plus, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAsync } from '../../hooks/useAsync';
import { getNextBooking, listBookings } from '../../api/bookings';
import { listFavoriteRooms } from '../../api/rooms';
import { getMyStats } from '../../api/stats';
import { NOW } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/States';
import { HeroAccueil } from '../../components/home/HeroAccueil';
import { KpiTile, KpiTileSkeleton } from '../../components/stats/KpiTile';
import { NextBookingCard } from '../../components/home/NextBookingCard';
import { QuickSearchCard } from '../../components/home/QuickSearchCard';
import { UpcomingSlots } from '../../components/home/UpcomingSlots';
import { FavoriteRooms } from '../../components/home/FavoriteRooms';

/**
 * U-01 — Dashboard d'accueil.
 * Quatre chargements indépendants : un échec isolé n'emporte pas toute la page.
 */
export default function DashboardPage() {
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'Accueil — SmartRoom Manager';
  }, []);

  const next = useAsync(() => getNextBooking(user.id), [user.id]);
  const stats = useAsync(() => getMyStats('mois', user.id), [user.id]);
  const upcoming = useAsync(
    () => listBookings({ ownerId: user.id, from: NOW, status: 'confirmee' }),
    [user.id],
  );
  const favorites = useAsync(() => listFavoriteRooms(user.id), [user.id]);

  const nextId = next.data?.id;
  const otherSlots = (upcoming.data ?? []).filter((booking) => booking.id !== nextId).slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <HeroAccueil
        prenom={user.firstName}
        batimentPrefere={user.preferences?.preferredBuildingId}
        action={
          <Button to="/app/reservation/besoin" icon={Plus}>
            Nouvelle réservation
          </Button>
        }
      />

      {/* Les chiffres d'abord, juste sous le bandeau, comme les quatre tuiles
          de la maquette : on sait où on en est avant de lire le détail. */}
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        {stats.isLoading && (
          <>
            <KpiTileSkeleton />
            <KpiTileSkeleton />
            <KpiTileSkeleton />
          </>
        )}
        {stats.isSuccess && (
          <>
            <KpiTile
              icon={CalendarCheck}
              teinte="marine"
              value={stats.data.kpis.bookings}
              label="réservations ce mois"
              className="animate-fade-in-up"
            />
            <KpiTile
              icon={Clock}
              teinte="corail"
              value={stats.data.kpis.hours}
              unit="h"
              label="heures réservées"
              className="animate-fade-in-up [animation-delay:60ms]"
            />
            <KpiTile
              icon={XCircle}
              teinte="framboise"
              value={stats.data.kpis.cancelled}
              label={stats.data.kpis.cancelled > 1 ? 'annulations' : 'annulation'}
              className="animate-fade-in-up [animation-delay:120ms]"
            />
          </>
        )}
        {stats.isError && (
          <div className="card-surface sm:col-span-3">
            <ErrorState error={stats.error} onRetry={stats.reload} title="Statistiques indisponibles" />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        {next.isError ? (
          <div className="card-surface">
            <ErrorState error={next.error} onRetry={next.reload} />
          </div>
        ) : (
          <NextBookingCard booking={next.data} isLoading={next.isLoading} />
        )}

        <QuickSearchCard defaultBuildingId={user.preferences?.preferredBuildingId} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {upcoming.isError ? (
          <div className="card-surface">
            <ErrorState error={upcoming.error} onRetry={upcoming.reload} />
          </div>
        ) : (
          <UpcomingSlots bookings={otherSlots} isLoading={upcoming.isLoading} />
        )}

        {favorites.isError ? (
          <div className="card-surface">
            <ErrorState error={favorites.error} onRetry={favorites.reload} />
          </div>
        ) : (
          <FavoriteRooms rooms={favorites.data ?? []} isLoading={favorites.isLoading} />
        )}
      </div>
    </div>
  );
}
