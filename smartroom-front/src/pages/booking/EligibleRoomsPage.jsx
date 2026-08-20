import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DoorOpen, SlidersHorizontal } from 'lucide-react';
import { recommendRooms } from '../../api/recommendations';
import { listBuildings } from '../../api/buildings';
import { listEquipment } from '../../api/equipment';
import { useAsync } from '../../hooks/useAsync';
import { useBooking } from '../../hooks/useBooking';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { plural } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Badge';
import { BottomSheet } from '../../components/ui/Modal';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../components/ui/States';
import { StaggerList } from '../../components/ui/StaggerList';
import { PageHeader } from '../../components/layout/PageHeader';
import { RecommendationCard, RoomCard } from '../../components/rooms/RoomCard';
import { RoomFilters } from '../../components/rooms/RoomFilters';

/**
 * U-03 — Salles éligibles, étape 2 du tunnel.
 * Le classement vient du moteur de recommandation ; les salles trop justes
 * restent affichées mais signalées, plutôt que de disparaître sans explication.
 */
export default function EligibleRoomsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { draft, need, hasDraft, selectRoom } = useBooking();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, setFilters] = useState({
    capacity: Number(draft.attendees) || 2,
    buildings: draft.buildingId ? [draft.buildingId] : [],
    equipment: draft.equipmentIds,
    floors: [],
    accessible: draft.accessible,
  });

  useEffect(() => {
    document.title = 'Salles éligibles — SmartRoom Manager';
  }, []);

  const buildings = useAsync(listBuildings, []);
  const equipment = useAsync(listEquipment, []);
  const ranked = useAsync(
    () => recommendRooms({ ...need, attendees: filters.capacity, equipmentIds: filters.equipment }),
    [need.buildingId, filters.capacity, filters.equipment],
  );

  const results = useMemo(() => {
    const rooms = ranked.data ?? [];
    return rooms.filter((entry) => {
      if (filters.buildings.length && !filters.buildings.includes(entry.room.buildingId)) return false;
      if (filters.floors.length && !filters.floors.includes(entry.room.floor)) return false;
      if (filters.accessible && !entry.room.accessible) return false;
      return true;
    });
  }, [ranked.data, filters.buildings, filters.floors, filters.accessible]);

  if (!hasDraft) return <Navigate to="/app/reservation/besoin" replace />;

  const [best, ...others] = results;
  const floors = [...new Set((ranked.data ?? []).map((entry) => entry.room.floor))].sort();

  const activeChips = [
    ...filters.buildings.map((id) => ({
      key: `b-${id}`,
      label: (buildings.data ?? []).find((b) => b.id === id)?.name ?? id,
      remove: () => setFilters((c) => ({ ...c, buildings: c.buildings.filter((x) => x !== id) })),
    })),
    ...filters.equipment.map((id) => ({
      key: `e-${id}`,
      label: (equipment.data ?? []).find((e) => e.id === id)?.label ?? id,
      remove: () => setFilters((c) => ({ ...c, equipment: c.equipment.filter((x) => x !== id) })),
    })),
    { key: 'cap', label: `${filters.capacity}+ personnes` },
  ];

  const chooseRoom = (room) => {
    selectRoom(room);
    navigate(`/app/reservation/salles/${room.id}`);
  };

  const filtersPanel = (
    <RoomFilters
      value={filters}
      onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
      buildings={buildings.data ?? []}
      equipment={equipment.data ?? []}
      floors={floors}
      onReset={() =>
        setFilters({ capacity: 2, buildings: [], equipment: [], floors: [], accessible: false })
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Salles éligibles"
        subtitle={
          ranked.isSuccess ? `${plural(results.length, 'résultat')} pour votre besoin` : 'Analyse en cours…'
        }
        actions={
          isMobile && (
            <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setSheetOpen(true)}>
              Filtres
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-content-muted">Filtres actifs :</span>
        {activeChips.map((chip) => (
          <Chip key={chip.key} label={chip.label} onRemove={chip.remove} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {!isMobile && filtersPanel}

        <AsyncBoundary
          status={ranked.status}
          error={ranked.error}
          onRetry={ranked.reload}
          isEmpty={ranked.isSuccess && results.length === 0}
          skeleton={
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonCard key={index} />
              ))}
            </div>
          }
          empty={
            <div className="card-surface">
              <EmptyState
                icon={DoorOpen}
                title="Aucune salle ne correspond"
                description="Élargissez la capacité, retirez un équipement ou changez de bâtiment."
                action={
                  <Button size="sm" variant="secondary" to="/app/reservation/besoin">
                    Modifier mon besoin
                  </Button>
                }
              />
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {best && (
              <RecommendationCard
                entry={best}
                action={
                  <Button size="sm" fullWidth onClick={() => chooseRoom(best.room)}>
                    Voir les créneaux
                  </Button>
                }
              />
            )}

            <StaggerList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {others.map((entry) => (
                <RoomCard
                  key={entry.room.id}
                  room={entry.room}
                  badge={entry.eligible ? undefined : 'À capacité juste'}
                  action={
                    <Button
                      size="sm"
                      fullWidth
                      variant={entry.eligible ? 'primary' : 'secondary'}
                      onClick={() => chooseRoom(entry.room)}
                    >
                      Voir les créneaux
                    </Button>
                  }
                />
              ))}
            </StaggerList>
          </div>
        </AsyncBoundary>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filtres">
        {filtersPanel}
      </BottomSheet>
    </div>
  );
}
