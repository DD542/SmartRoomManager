import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Search, SlidersHorizontal } from 'lucide-react';
import { listRooms } from '../../api/rooms';
import { listBuildings } from '../../api/buildings';
import { listEquipment } from '../../api/equipment';
import { useAsync } from '../../hooks/useAsync';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { normalize, plural } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/Tabs';
import { BottomSheet } from '../../components/ui/Modal';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../components/ui/States';
import { Pagination, paginate } from '../../components/ui/Table';
import { StaggerList } from '../../components/ui/StaggerList';
import { PageHeader } from '../../components/layout/PageHeader';
import { RoomCard } from '../../components/rooms/RoomCard';
import { RoomFilters } from '../../components/rooms/RoomFilters';

const PAGE_SIZE = 6;

const SORTS = [
  { value: 'pertinence', label: 'Pertinence' },
  { value: 'capacite', label: 'Capacité' },
  { value: 'occupation', label: 'Occupation' },
];

/** U-16 — Explorer les salles : recherche, filtres, tri, pagination. */
export default function ExploreRoomsPage() {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('pertinence');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, setFilters] = useState({
    capacity: 2,
    buildings: [],
    equipment: [],
    floors: [],
    accessible: false,
  });

  useEffect(() => {
    document.title = 'Explorer les salles — SmartRoom Manager';
  }, []);

  const buildings = useAsync(listBuildings, []);
  const equipment = useAsync(listEquipment, []);
  const rooms = useAsync(
    () =>
      listRooms({
        capacity: filters.capacity,
        buildings: filters.buildings,
        equipment: filters.equipment,
        floors: filters.floors,
        accessible: filters.accessible,
      }),
    [filters],
  );

  const results = useMemo(() => {
    const q = normalize(query);
    const list = (rooms.data ?? []).filter((room) =>
      q ? normalize(`${room.name} ${room.description}`).includes(q) : true,
    );
    if (sort === 'capacite') return [...list].sort((a, b) => b.capacity - a.capacity);
    if (sort === 'occupation') return [...list].sort((a, b) => a.occupancyRate - b.occupancyRate);
    return list;
  }, [rooms.data, query, sort]);

  const paged = paginate(results, page, PAGE_SIZE);
  const floors = [...new Set((rooms.data ?? []).map((room) => room.floor))].sort();

  const filtersPanel = (
    <RoomFilters
      value={filters}
      onChange={(patch) => {
        setFilters((current) => ({ ...current, ...patch }));
        setPage(1);
      }}
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
        title="Explorer les salles"
        subtitle={rooms.isSuccess ? `${plural(results.length, 'salle trouvée', 'salles trouvées')}` : 'Chargement…'}
        actions={
          <>
            <SegmentedControl label="Trier par" options={SORTS} value={sort} onChange={setSort} />
            {isMobile && (
              <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setSheetOpen(true)}>
                Filtres
              </Button>
            )}
          </>
        }
      />

      <Card className="p-3">
        <label htmlFor="recherche-salles" className="sr-only">
          Rechercher une salle
        </label>
        <div className="relative">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
          />
          <input
            id="recherche-salles"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Nom de la salle, description…"
            className="h-9 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {!isMobile && filtersPanel}

        <AsyncBoundary
          status={rooms.status}
          error={rooms.error}
          onRetry={rooms.reload}
          isEmpty={rooms.isSuccess && results.length === 0}
          skeleton={
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonCard key={index} />
              ))}
            </div>
          }
          empty={
            <Card>
              <EmptyState
                icon={DoorOpen}
                title="Aucune salle ne correspond"
                description="Ajustez la capacité, retirez un équipement ou changez de bâtiment."
              />
            </Card>
          }
        >
          <div className="flex flex-col gap-4">
            <StaggerList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {paged.items.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </StaggerList>

            {paged.pageCount > 1 && (
              <Card>
                <Pagination
                  page={paged.page}
                  pageCount={paged.pageCount}
                  total={paged.total}
                  pageSize={PAGE_SIZE}
                  onChange={setPage}
                  label="salles"
                />
              </Card>
            )}
          </div>
        </AsyncBoundary>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filtres">
        {filtersPanel}
      </BottomSheet>
    </div>
  );
}
