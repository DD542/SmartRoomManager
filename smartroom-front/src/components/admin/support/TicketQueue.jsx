import { cn } from '../../../utils/cn';
import { Badge, Pill } from '../../ui/Badge';
import { Avatar } from '../../ui/Avatar';
import { fmtRelative } from '../../../utils/dates';
import { TICKET_STATUS_LABEL } from '../../../utils/format';

const STATUT_TON = { ouvert: 'warning', en_cours: 'accent', resolu: 'success' };

export const ONGLETS = [
  { value: 'ouverts', label: 'Ouverts' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'resolus', label: 'Résolus' },
  { value: 'tous', label: 'Tous' },
];

/**
 * A-13 — file de traitement.
 *
 * Triée du plus récemment mis à jour au plus ancien : un ticket qui vient de
 * recevoir une réponse de l'utilisateur remonte en tête.
 */
export function TicketQueue({ tickets = [], counts = {}, tab, onTabChange, selectedId, onSelect }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3">
        {ONGLETS.map((onglet) => (
          <Pill
            key={onglet.value}
            active={tab === onglet.value}
            count={counts[onglet.value] ?? 0}
            onClick={() => onTabChange(onglet.value)}
          >
            {onglet.label}
          </Pill>
        ))}
      </div>

      <ul className="flex flex-col gap-2 p-3">
        {tickets.map((ticket, index) => {
          const actif = selectedId === ticket.id;
          return (
            <li
              key={ticket.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
            >
              <button
                type="button"
                onClick={() => onSelect(ticket)}
                aria-current={actif ? 'true' : undefined}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition',
                  actif
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface-raised hover:border-line-strong',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-content-muted">#{ticket.id}</span>
                  <Badge tone={STATUT_TON[ticket.status] ?? 'default'} dot>
                    {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                  </Badge>
                </span>
                <span className="mt-1.5 block truncate text-sm text-content">{ticket.subject}</span>
                <span className="mt-1.5 flex items-center gap-2 text-[11px] text-content-faint">
                  <Avatar name={ticket.requester?.name ?? ''} size="sm" />
                  <span className="truncate">
                    {ticket.requester?.name}
                    {ticket.roomName ? ` · ${ticket.roomName}` : ''}
                  </span>
                  <span className="ml-auto shrink-0">{fmtRelative(ticket.updatedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
