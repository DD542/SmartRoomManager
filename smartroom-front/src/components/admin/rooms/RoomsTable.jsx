import { Accessibility, KeyRound } from 'lucide-react';
import { Badge, OccupancyBar } from '../../ui/Badge';
import { CompactGauge } from '../CompactGauge';
import { DataTable } from '../DataTable';
import { EquipmentIcons } from '../../rooms/RoomCard';
import { fmtArea, ROOM_STATUS_LABEL } from '../../../utils/format';

const STATUT_TON = { disponible: 'success', maintenance: 'warning', archivee: 'muted' };

const colonnes = [
  {
    key: 'name',
    label: 'Salle',
    render: (row) => (
      <span className="flex flex-col">
        <span className="text-content">{row.name}</span>
        <span className="text-[11px] text-content-faint">
          {row.buildingName} · {row.floor} · {fmtArea(row.area)}
        </span>
      </span>
    ),
  },
  { key: 'capacity', label: 'Capacité', align: 'right', render: (row) => `${row.capacity} pl.` },
  {
    key: 'equipmentCount',
    label: 'Équipements',
    render: (row) => <EquipmentIcons equipment={row.equipment ?? []} />,
  },
  {
    key: 'access',
    label: 'Accès',
    sortable: false,
    render: (row) => (
      <span className="flex items-center gap-1.5 text-content-muted">
        {row.badgeRequired && <KeyRound size={13} aria-label="Badge requis" />}
        {row.accessible && <Accessibility size={13} aria-label="Accessible PMR" />}
        {!row.badgeRequired && !row.accessible && <span className="text-content-faint">—</span>}
      </span>
    ),
  },
  {
    key: 'occupancyRate',
    label: 'Occupation',
    render: (row) => <CompactGauge rate={row.occupancyRate} label={`Occupation de ${row.name}`} />,
  },
  { key: 'bookingCount', label: 'Réservations', align: 'right' },
  {
    key: 'status',
    label: 'Statut',
    render: (row) => (
      <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
        {ROOM_STATUS_LABEL[row.status] ?? row.status}
      </Badge>
    ),
  },
];

/** Aplatit les objets imbriqués pour que le tri par colonne porte sur du texte. */
export const toRoomRow = (room) => ({
  ...room,
  buildingName: room.building?.name ?? '—',
  equipmentCount: room.equipment?.length ?? 0,
});

/**
 * A-05 — catalogue administrable.
 *
 * Sous 768 px, la page rend des cartes : sept colonnes ne se consultent pas au
 * doigt sur un défilement horizontal.
 */
export function RoomsTable({ table, onSelect, selectedId }) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable columns={colonnes} table={table} selectable rowLabel="salles" onRowClick={onSelect} />
      </div>

      <ul className="flex flex-col gap-2 p-3 md:hidden">
        {table.rows.map((row, index) => (
          <li key={row.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
            <button
              type="button"
              onClick={() => onSelect?.(row)}
              aria-current={selectedId === row.id ? 'true' : undefined}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selectedId === row.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-raised'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-content">{row.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-content-muted">
                  {row.capacity} pl.
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-content-faint">
                {row.buildingName} · {row.floor} · {fmtArea(row.area)}
              </span>
              <span className="mt-2 block">
                <OccupancyBar rate={row.occupancyRate} />
              </span>
              <span className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
                  {ROOM_STATUS_LABEL[row.status] ?? row.status}
                </Badge>
                <span className="text-[11px] text-content-muted">
                  {row.bookingCount} réservation(s)
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
