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
    priority: 'primary',
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
  { key: 'promotion', label: 'Promotion', priority: 'secondary' },
  { key: 'department', label: 'Département', priority: 'tertiary' },
  { key: 'bookings', label: 'Réservations', priority: 'primary', align: 'right' },
  {
    key: 'noShowRate',
    label: 'No-show',
    priority: 'secondary',
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
    priority: 'primary',
    render: (row) => <Fiabilite score={row.reliabilityScore} />,
  },
  {
    key: 'remainingCreditsH',
    label: 'Crédits',
    priority: 'secondary',
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
    priority: 'primary',
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
 * A-10 — annuaire administrable.
 *
 * Le nom, le nombre de réservations, la fiabilité et le statut identifient un
 * compte et disent s'il pose problème : ils survivent jusqu'à la carte. La
 * promotion, le taux d'absence et les crédits se replient. Le département est
 * un confort de grand écran.
 *
 * La bascule en cartes vivait ici, en double du tableau ; elle est portée par
 * `DataTable`, qui la déduit des rangs déclarés plus haut.
 */
export function UsersTable({ table, onSelect, selectedId }) {
  return (
    <DataTable
      columns={colonnes}
      table={table}
      rowLabel="utilisateurs"
      rowName={(row) => row.name}
      onRowClick={onSelect}
      isRowActive={(row) => row.id === selectedId}
    />
  );
}
