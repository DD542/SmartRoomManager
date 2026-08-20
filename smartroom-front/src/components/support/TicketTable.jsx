import { ChevronRight } from 'lucide-react';
import { fmtRelative } from '../../utils/dates';
import { TICKET_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Table } from '../ui/Table';

const TONE = { ouvert: 'warning', en_cours: 'accent', resolu: 'success' };
const CATEGORY = { acces: 'Accès', equipement: 'Équipement', maintenance: 'Maintenance', compte: 'Compte' };

/** U-22 — tableau « Mes demandes », avec ouverture du fil de discussion. */
export function TicketTable({ tickets = [], onOpen }) {
  const columns = [
    {
      key: 'subject',
      label: 'ID & sujet',
      render: (ticket) => (
        <span>
          <span className="block text-sm text-content">{ticket.subject}</span>
          <span className="font-mono text-xs text-content-muted">#{ticket.id}</span>
        </span>
      ),
    },
    {
      key: 'category',
      label: 'Catégorie',
      render: (ticket) => <span className="text-xs">{CATEGORY[ticket.category]}</span>,
    },
    {
      key: 'status',
      label: 'Statut',
      render: (ticket) => (
        <Badge tone={TONE[ticket.status] ?? 'default'} dot>
          {TICKET_STATUS_LABEL[ticket.status]}
        </Badge>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Dernière mise à jour',
      render: (ticket) => (
        <span className="font-mono text-xs text-content-muted">{fmtRelative(ticket.updatedAt)}</span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (ticket) => (
        <button
          type="button"
          onClick={() => onOpen(ticket)}
          aria-label={`Ouvrir le ticket ${ticket.id}`}
          className="inline-flex text-content-muted transition hover:text-content"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ),
    },
  ];

  return <Table columns={columns} rows={tickets} caption="Mes demandes d’assistance" onRowClick={onOpen} />;
}
