import { Eye, Pencil, Send, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/Button';
import { DataTable } from '../DataTable';
import { fmtDate } from '../../../utils/dates';

/**
 * A-14 — liste des articles d'aide.
 *
 * Publier et dépublier sont la même bascule : un article retiré du centre
 * d'aide redevient brouillon, il n'est jamais perdu.
 */
export function ArticlesTable({ table, busy = false, onEdit, onToggleStatus, onDelete }) {
  const colonnes = [
    {
      key: 'title',
      label: 'Article',
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-content">{row.title}</span>
          <span className="truncate text-[11px] text-content-faint">{row.excerpt}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'État',
      render: (row) => (
        <Badge tone={row.status === 'publie' ? 'success' : 'default'} dot>
          {row.status === 'publie' ? 'Publié' : 'Brouillon'}
        </Badge>
      ),
    },
    {
      key: 'views',
      label: 'Vues',
      align: 'right',
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-content-muted">
          <Eye size={12} aria-hidden="true" />
          {row.views}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Mise à jour',
      render: (row) => (
        <span className="font-mono text-xs text-content-muted">
          {row.updatedAt ? fmtDate(row.updatedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          <IconButton
            icon={row.status === 'publie' ? Undo2 : Send}
            label={row.status === 'publie' ? `Dépublier ${row.title}` : `Publier ${row.title}`}
            disabled={busy}
            onClick={() => onToggleStatus(row)}
          />
          <IconButton icon={Pencil} label={`Modifier ${row.title}`} onClick={() => onEdit(row)} />
          <IconButton
            icon={Trash2}
            label={`Supprimer ${row.title}`}
            disabled={busy}
            onClick={() => onDelete(row)}
          />
        </span>
      ),
    },
  ];

  return <DataTable columns={colonnes} table={table} rowLabel="articles" />;
}
