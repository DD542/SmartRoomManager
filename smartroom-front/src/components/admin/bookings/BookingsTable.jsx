import { Badge } from '../../ui/Badge';
import { DataTable } from '../DataTable';
import { AttendanceBadge, SourceBadge } from './SourceBadge';
import { fmtDate, fmtTime } from '../../../utils/dates';
import { BOOKING_STATUS_LABEL, fullName } from '../../../utils/format';

const STATUT_TON = { confirmee: 'success', terminee: 'default', annulee: 'danger' };

const colonnes = [
  {
    key: 'start',
    label: 'Créneau',
    priority: 'primary',
    render: (row) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs text-content">{fmtDate(row.start)}</span>
        <span className="font-mono text-[11px] text-content-muted">
          {fmtTime(row.start)} – {fmtTime(row.end)}
        </span>
      </span>
    ),
  },
  { key: 'title', label: 'Objet', priority: 'primary' },
  { key: 'roomName', label: 'Salle', priority: 'primary' },
  {
    key: 'ownerName',
    label: 'Organisateur',
    priority: 'secondary',
    render: (row) => row.ownerName ?? <span className="text-content-faint">—</span>,
  },
  { key: 'source', label: 'Source', priority: 'tertiary', render: (row) => <SourceBadge source={row.source} /> },
  {
    key: 'status',
    label: 'Statut',
    priority: 'primary',
    render: (row) => (
      <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
        {BOOKING_STATUS_LABEL[row.status] ?? row.status}
      </Badge>
    ),
  },
  {
    key: 'attendance',
    label: 'Présence',
    priority: 'secondary',
    render: (row) => <AttendanceBadge attendance={row.attendance} />,
  },
];

/** Aplatit les objets imbriqués pour que le tri par colonne porte sur du texte. */
export const toRow = (booking) => ({
  ...booking,
  roomName: booking.room?.name ?? '—',
  ownerName: booking.owner ? fullName(booking.owner) : null,
});

/**
 * A-18 — table des réservations.
 *
 * Créneau, objet, salle et statut : c'est ce qu'on lit pour décider s'il faut
 * ouvrir la ligne. L'organisateur et la présence se replient, la source est un
 * confort de grand écran — elle départage deux réservations identiques, ce qui
 * n'arrive qu'à l'examen.
 */
export function BookingsTable({ table, onSelect, selectedId }) {
  return (
    <DataTable
      columns={colonnes}
      table={table}
      selectable
      rowLabel="réservations"
      rowName={(row) => `${row.title} — ${row.roomName}`}
      onRowClick={onSelect}
      isRowActive={(row) => row.id === selectedId}
    />
  );
}
