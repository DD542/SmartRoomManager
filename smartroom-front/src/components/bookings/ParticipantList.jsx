import { useState } from 'react';
import { Users } from 'lucide-react';
import { PARTICIPANT_STATUS_LABEL } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';

const TONE = { accepte: 'success', en_attente: 'warning', decline: 'danger' };

/** Liste des participants d'une réservation, repliée au-delà de trois entrées. */
export function ParticipantList({ participants = [], previewCount = 3 }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? participants : participants.slice(0, previewCount);
  const rest = participants.length - shown.length;

  const counts = participants.reduce(
    (acc, participant) => ({ ...acc, [participant.status]: (acc[participant.status] ?? 0) + 1 }),
    {},
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-content-muted">
          <Users size={13} aria-hidden="true" />
          Participants ({participants.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([status, count]) => (
            <Badge key={status} tone={TONE[status] ?? 'default'} dot>
              {count} {PARTICIPANT_STATUS_LABEL[status]?.toLowerCase()}
            </Badge>
          ))}
        </div>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((participant) => (
          <li key={participant.email} className="flex items-center gap-2.5">
            <Avatar name={participant.name} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-content">
                {participant.name}
                {participant.organizer && (
                  <span className="ml-1 text-xs text-accent">(organisateur)</span>
                )}
              </span>
              <span className="block truncate text-xs text-content-muted">{participant.email}</span>
            </span>
          </li>
        ))}
      </ul>

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-xs text-accent transition hover:text-accent-hover"
        >
          Voir tous les participants (+{rest})
        </button>
      )}
    </div>
  );
}
