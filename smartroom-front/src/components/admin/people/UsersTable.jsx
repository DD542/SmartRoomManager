import { Badge } from '../../ui/Badge';
import { Avatar } from '../../ui/Avatar';
import { CompactGauge } from '../CompactGauge';
import { DataTable } from '../DataTable';
import { fmtPercent, fullName } from '../../../utils/format';

/** Un compte sans historique n'a pas de score : « — » vaut mieux qu'un 100/100. */
function Fiabilite({ score }) {
  if (score === null || score === undefined) {
    return <span className="text-content-faint">—</span>;
  }
  const tone = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return <Badge tone={tone}>{score}/100</Badge>;
}

const colonnes = [
  {
    key: 'name',
    label: 'Utilisateur',
    render: (row) => (
      <span className="flex items-center gap-2.5">
        <Avatar name={row.name} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-content">{row.name}</span>
          <span className="block truncate text-[11px] text-content-faint">{row.email}</span>
        </span>
      </span>
    ),
  },
  { key: 'promotion', label: 'Promotion' },
  { key: 'department', label: 'Département' },
  { key: 'bookings', label: 'Réservations', align: 'right' },
  {
    key: 'noShowRate',
    label: 'No-show',
    align: 'right',
    render: (row) => (
      <span className={row.noShowRate >= 0.2 ? 'text-danger' : 'text-content'}>
        {fmtPercent(row.noShowRate)}
      </span>
    ),
  },
  {
    key: 'reliabilityScore',
    label: 'Fiabilité',
    render: (row) => <Fiabilite score={row.reliabilityScore} />,
  },
  {
    key: 'remainingCreditsH',
    label: 'Crédits',
    render: (row) => (
      <CompactGauge
        rate={Math.min(1, row.remainingCreditsH / Math.max(1, row.quotaHours))}
        label={`Crédits restants de ${row.name}`}
      />
    ),
  },
  {
    key: 'status',
    label: 'Statut',
    render: (row) => (
      <Badge tone={row.status === 'actif' ? 'success' : 'danger'} dot>
        {row.status === 'actif' ? 'Actif' : 'Suspendu'}
      </Badge>
    ),
  },
];

/** Aplatit les métriques pour que le tri porte sur des valeurs comparables. */
export const toUserRow = (user) => ({
  ...user,
  name: fullName(user),
  quotaHours: user.preferences?.weeklyQuotaHours ?? 12,
  bookings: user.metrics.bookings,
  noShowRate: user.metrics.noShowRate,
  reliabilityScore: user.metrics.reliabilityScore,
  remainingCreditsH: user.metrics.remainingCreditsH,
});

/**
 * A-11 — annuaire administrable.
 *
 * Sous 768 px, la page rend des cartes : huit colonnes ne se consultent pas au
 * doigt sur un défilement horizontal.
 */
export function UsersTable({ table, onSelect, selectedId }) {
  return (
    <DataTable
      columns={colonnes}
      table={table}
      rowLabel="utilisateurs"
      onRowClick={onSelect}
      carte={(row) => (
            <button
              type="button"
              onClick={() => onSelect?.(row)}
              aria-current={selectedId === row.id ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                selectedId === row.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-raised'
              }`}
            >
              <Avatar name={row.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">{row.name}</span>
                <span className="block truncate text-[11px] text-content-faint">
                  {row.promotion} · {row.bookings} réservation(s)
                </span>
              </span>
              <Fiabilite score={row.reliabilityScore} />
            </button>
      )}
    />
  );
}
