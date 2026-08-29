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
    render: (row) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs text-content">{fmtDate(row.start)}</span>
        <span className="font-mono text-[11px] text-content-muted">
          {fmtTime(row.start)} – {fmtTime(row.end)}
        </span>
      </span>
    ),
  },
  { key: 'title', label: 'Objet' },
  { key: 'roomName', label: 'Salle' },
  {
    key: 'ownerName',
    label: 'Organisateur',
    render: (row) => row.ownerName ?? <span className="text-content-faint">—</span>,
  },
  { key: 'source', label: 'Source', render: (row) => <SourceBadge source={row.source} /> },
  {
    key: 'status',
    label: 'Statut',
    render: (row) => (
      <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
        {BOOKING_STATUS_LABEL[row.status] ?? row.status}
      </Badge>
    ),
  },
  {
    key: 'attendance',
    label: 'Présence',
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
 * A-03 — table des réservations.
 *
 * Sous 768 px, la page rend des cartes : sept colonnes ne se consultent pas au
 * doigt sur un défilement horizontal.
 */
export function BookingsTable({ table, onSelect, selectedId }) {
  return (
    <>
      <div className="hidden lg:block">
        <DataTable
          columns={colonnes}
          table={table}
          selectable
          rowLabel="réservations"
          rowName={(row) => `${row.title} — ${row.roomName}`}
          onRowClick={onSelect}
        />
      </div>

      <ul className="flex flex-col gap-2 p-3 lg:hidden">
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
                <span className="truncate text-sm text-content">{row.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-content-muted">
                  {fmtDate(row.start)}
                </span>
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-content-muted">
                {fmtTime(row.start)} – {fmtTime(row.end)} · {row.roomName}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <SourceBadge source={row.source} />
                <Badge tone={STATUT_TON[row.status] ?? 'default'} dot>
                  {BOOKING_STATUS_LABEL[row.status] ?? row.status}
                </Badge>
                <AttendanceBadge attendance={row.attendance} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
