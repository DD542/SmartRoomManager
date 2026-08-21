import { ChevronRight } from 'lucide-react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fmtRelative } from '../../utils/dates';
import { TICKET_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Table } from '../ui/Table';
import { StaggerList } from '../ui/StaggerList';

const TONE = { ouvert: 'warning', en_cours: 'accent', resolu: 'success' };
const CATEGORY = {
  acces: 'Accès',
  equipement: 'Équipement',
  maintenance: 'Maintenance',
  compte: 'Compte',
};

/**
 * U-22 — « Mes demandes ».
 * Tableau sur grand écran, cartes empilées sous 768px : le tableau imposerait
 * un défilement horizontal, où la colonne d'action finit hors du cadre.
 */
export function TicketTable({ tickets = [], onOpen }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <StaggerList className="flex flex-col gap-2 p-3">
        {tickets.map((ticket) => (
          <button
            key={ticket.id}
            type="button"
            onClick={() => onOpen(ticket)}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-raised p-3 text-left transition hover:border-line-strong"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-content">{ticket.subject}</span>
              <span className="mt-0.5 block font-mono text-xs text-content-muted">
                #{ticket.id} · {CATEGORY[ticket.category]}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={TONE[ticket.status] ?? 'default'} dot>
                  {TICKET_STATUS_LABEL[ticket.status]}
                </Badge>
                <span className="font-mono text-xs text-content-faint">
                  {fmtRelative(ticket.updatedAt)}
                </span>
              </span>
            </span>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-content-muted" />
          </button>
        ))}
      </StaggerList>
    );
  }

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

  return (
    <Table columns={columns} rows={tickets} caption="Mes demandes d’assistance" onRowClick={onOpen} />
  );
}
