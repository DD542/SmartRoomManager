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
    priority: 'primary',
    render: (row) => (
      <span className="font-mono text-xs text-content-muted">
        {fmtDate(row.at)} · {fmtTime(row.at)}
      </span>
    ),
  },
  {
    key: 'authorName',
    label: 'Auteur',
    priority: 'primary',
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
    priority: 'primary',
    render: (row) => (
      <Badge tone={ACTION_TON[row.action] ?? 'default'} dot>
        {actionLabels[row.action] ?? row.action}
      </Badge>
    ),
  },
  {
    key: 'target',
    label: 'Cible',
    priority: 'primary',
    render: (row) => (
      <span className="flex items-center gap-1.5">
        <span className="truncate text-content">{row.target}</span>
        {row.flagged && (
          <Flag size={12} aria-label="Action signalée" className="shrink-0 text-danger" />
        )}
      </span>
    ),
  },
  { key: 'ip', label: 'Adresse IP', priority: 'secondary', align: 'right', render: (row) => (
    <span className="font-mono text-xs text-content-faint">{row.ip}</span>
  ) },
];

/**
 * A-16 — journal paginé.
 *
 * Le journal est immuable : aucune ligne n'est modifiable ni supprimable, seul
 * un signalement peut s'y ajouter. C'est ce qui rend l'audit opposable.
 *
 * Quatre colonnes sur cinq sont de premier rang : un journal se lit pour
 * savoir qui a fait quoi, à quoi, et quand — retirer l'un des quatre le rend
 * muet. Seule l'adresse IP se replie.
 */
export function AuditTable({ table, onSelect }) {
  return (
    <DataTable
      columns={colonnes}
      table={table}
      rowLabel="actions"
      rowName={(row) => row.target}
      onRowClick={onSelect}
    />
  );
}
