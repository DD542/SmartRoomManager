import { Accessibility, KeyRound } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { CompactGauge } from '../CompactGauge';
import { DataTable } from '../DataTable';
import { EquipmentIcons } from '../../rooms/RoomCard';
import { fmtArea, ROOM_STATUS_LABEL } from '../../../utils/format';

const STATUT_TON = { disponible: 'success', maintenance: 'warning', archivee: 'muted' };

/**
 * A-03 — colonnes du parc, et ce qu'il advient de chacune quand l'écran
 * rétrécit.
 *
 * Le nom, la capacité et le statut identifient une salle : sans eux la ligne
 * ne veut plus rien dire, ils survivent donc jusqu'à la carte. L'occupation,
 * les équipements et le mode d'accès se consultent, ils se replient. Le
 * nombre de réservations est un confort de grand écran.
 */
const colonnes = [
  {
    key: 'name',
    label: 'Salle',
    priority: 'primary',
    render: (row) => (
      <span className="flex flex-col">
        <span className="text-content">{row.name}</span>
        <span className="text-[11px] text-content-faint">
          {row.buildingName} · {row.floor} · {fmtArea(row.area)}
        </span>
      </span>
    ),
  },
  {
    key: 'capacity',
    label: 'Capacité',
    priority: 'primary',
    align: 'right',
    render: (row) => `${row.capacity} pl.`,
  },
  {
    key: 'status',
    label: 'Statut',
    priority: 'primary',
    render: (row) => (
      <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
        {ROOM_STATUS_LABEL[row.status] ?? row.status}
      </Badge>
    ),
  },
  {
    key: 'occupancyRate',
    label: 'Occupation',
    priority: 'secondary',
    render: (row) => <CompactGauge rate={row.occupancyRate} label={`Occupation de ${row.name}`} />,
  },
  {
    key: 'equipmentCount',
    label: 'Équipements',
    priority: 'secondary',
    render: (row) => <EquipmentIcons equipment={row.equipment ?? []} />,
  },
  {
    key: 'access',
    label: 'Accès',
    priority: 'secondary',
    sortable: false,
    render: (row) => (
      <span className="flex items-center gap-1.5 text-content-muted">
        {row.badgeRequired && <KeyRound size={13} aria-label="Badge requis" />}
        {row.accessible && <Accessibility size={13} aria-label="Accessible PMR" />}
        {!row.badgeRequired && !row.accessible && <span className="text-content-faint">—</span>}
      </span>
    ),
  },
  { key: 'bookingCount', label: 'Réservations', priority: 'tertiary', align: 'right' },
];

/** Aplatit les objets imbriqués pour que le tri par colonne porte sur du texte. */
export const toRoomRow = (room) => ({
  ...room,
  buildingName: room.building?.name ?? '—',
  equipmentCount: room.equipment?.length ?? 0,
});

/**
 * A-03 — catalogue administrable.
 *
 * La bascule en cartes était écrite ici, en double du tableau. Elle vit
 * désormais dans `DataTable`, qui la déduit des rangs déclarés ci-dessus :
 * cet écran ne décrit plus que ses colonnes.
 */
export function RoomsTable({ table, onSelect, selectedId }) {
  return (
    <DataTable
      columns={colonnes}
      table={table}
      selectable
      rowLabel="salles"
      rowName={(row) => row.name}
      onRowClick={onSelect}
      isRowActive={(row) => row.id === selectedId}
    />
  );
}
