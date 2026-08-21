import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';
import { OccupancyBar } from '../../ui/Badge';
import { CompactGauge } from '../CompactGauge';
import { DataTable } from '../DataTable';
import { useDataTable } from '../../../hooks/useDataTable';
import { fmtPercent, plural } from '../../../utils/format';
import { TableProperties } from 'lucide-react';

/** Au-delà de 20 %, l'absentéisme d'une salle mérite d'être signalé en couleur. */
const seuilNoShow = (taux) => (taux >= 0.2 ? 'text-danger' : 'text-content');

const COLONNES = [
  { key: 'room', label: 'Salle' },
  { key: 'building', label: 'Bâtiment' },
  { key: 'bookings', label: 'Réservations', align: 'right' },
  { key: 'hours', label: 'Heures', align: 'right', render: (row) => `${row.hours} h` },
  {
    key: 'occupancy',
    label: 'Occupation',
    render: (row) => <CompactGauge rate={row.occupancy} label={`Occupation de ${row.room}`} />,
  },
  {
    key: 'noShow',
    label: 'No-show',
    align: 'right',
    render: (row) => <span className={seuilNoShow(row.noShow)}>{fmtPercent(row.noShow)}</span>,
  },
];

/**
 * A-02 — détail par salle.
 *
 * Sous 768 px, le tableau de six colonnes cède la place à des cartes : une
 * grille défilante horizontalement ne se consulte pas au doigt.
 */
export function RoomReportTable({ rows = [], className }) {
  const navigate = useNavigate();
  const lignes = useMemo(() => rows.map((row) => ({ ...row, id: row.roomId })), [rows]);
  const utilisees = rows.filter((salle) => salle.bookings > 0).length;
  const table = useDataTable(lignes, { pageSize: 10, initialSort: { key: 'bookings', direction: 'desc' } });

  return (
    <Card className={className}>
      <CardHeader
        title="Détail par salle"
        subtitle={`${plural(rows.length, 'salle')} — ${utilisees} avec au moins une réservation`}
      />

      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState
            icon={TableProperties}
            title="Aucune salle à afficher"
            description="Aucune salle ne correspond aux filtres appliqués."
          />
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              columns={COLONNES}
              table={table}
              rowLabel="salles"
              onRowClick={(row) => navigate(`/admin/salles/${row.roomId}`)}
            />
          </div>
          <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
            {lignes.map((salle, index) => (
              <li
                key={salle.id}
                className="animate-fade-in-up rounded-xl border border-line bg-surface-raised p-3"
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm text-content">{salle.room}</p>
                  <p className="shrink-0 font-mono text-xs text-content-muted">{salle.hours} h</p>
                </div>
                <p className="mt-0.5 text-xs text-content-faint">{salle.building}</p>
                <div className="mt-2">
                  <OccupancyBar rate={salle.occupancy} />
                </div>
                <p className="mt-2 flex items-center justify-between text-xs text-content-muted">
                  <span>{plural(salle.bookings, 'réservation')}</span>
                  <span className={seuilNoShow(salle.noShow)}>
                    {fmtPercent(salle.noShow)} de no-show
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
