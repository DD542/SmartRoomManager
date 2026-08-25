import { Flag } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Avatar } from '../../ui/Avatar';
import { DataTable } from '../DataTable';
import { actionLabels } from '../../../api/admin/audit';
import { fmtDate, fmtTime } from '../../../utils/dates';

const ACTION_TON = {
  modification: 'accent',
  maintenance: 'warning',
  permission: 'success',
  suppression: 'danger',
  connexion: 'default',
};

const colonnes = [
  {
    key: 'at',
    label: 'Horodatage',
    render: (row) => (
      <span className="font-mono text-xs text-content-muted">
        {fmtDate(row.at)} · {fmtTime(row.at)}
      </span>
    ),
  },
  {
    key: 'authorName',
    label: 'Auteur',
    render: (row) => (
      <span className="flex items-center gap-2">
        <Avatar name={row.authorName ?? 'Système'} size="sm" />
        <span className="truncate text-content">{row.authorName ?? 'Système'}</span>
      </span>
    ),
  },
  {
    key: 'action',
    label: 'Action',
    render: (row) => (
      <Badge tone={ACTION_TON[row.action] ?? 'default'} dot>
        {actionLabels[row.action] ?? row.action}
      </Badge>
    ),
  },
  {
    key: 'target',
    label: 'Cible',
    render: (row) => (
      <span className="flex items-center gap-1.5">
        <span className="truncate text-content">{row.target}</span>
        {row.flagged && (
          <Flag size={12} aria-label="Action signalée" className="shrink-0 text-danger" />
        )}
      </span>
    ),
  },
  { key: 'ip', label: 'Adresse IP', align: 'right', render: (row) => (
    <span className="font-mono text-xs text-content-faint">{row.ip}</span>
  ) },
];

/**
 * A-16 — journal paginé.
 *
 * Le journal est immuable : aucune ligne n'est modifiable ni supprimable, seul
 * un signalement peut s'y ajouter. C'est ce qui rend l'audit opposable.
 */
export function AuditTable({ table, onSelect }) {
  return (
    <>
      <div className="hidden lg:block">
        <DataTable columns={colonnes} table={table} rowLabel="actions" onRowClick={onSelect} />
      </div>

      <ul className="flex flex-col gap-2 p-3 lg:hidden">
        {table.rows.map((row, index) => (
          <li key={row.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
            <button
              type="button"
              onClick={() => onSelect?.(row)}
              className="w-full rounded-xl border border-line bg-surface-raised p-3 text-left"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-content">{row.target}</span>
                <span className="shrink-0 font-mono text-[11px] text-content-faint">
                  {fmtDate(row.at)}
                </span>
              </span>
              <span className="mt-1.5 flex items-center gap-2 text-[11px] text-content-muted">
                <Badge tone={ACTION_TON[row.action] ?? 'default'} dot>
                  {actionLabels[row.action] ?? row.action}
                </Badge>
                {row.authorName ?? 'Système'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
