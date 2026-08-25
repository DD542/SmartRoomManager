import { FileText } from 'lucide-react';
import { cn } from '../../utils/cn';
import { ROOM_STATUS_LABEL } from '../../utils/format';

const TONE = {
  disponible: 'border-success/50 bg-success-soft text-success',
  occupee: 'border-line bg-surface-raised text-content-muted',
  maintenance: 'border-warning/50 bg-warning-soft text-warning',
  mienne: 'border-accent bg-accent-soft text-accent-bright',
};

/**
 * Affichage d'un plan déposé au format PDF.
 * Un PDF ne peut pas servir de fond cliquable : le document est présenté tel
 * quel, et les salles se choisissent dans la liste posée en dessous.
 */
export function PdfPlanView({ document: planDocument, rooms = [], mineIds = [], selectedId, onSelect, className }) {
  return (
    <div className={cn('rounded-xl border border-line bg-ink p-3', className)}>
      <iframe
        src={planDocument.url}
        title={`Plan officiel : ${planDocument.name}`}
        className="h-[22rem] w-full rounded-lg border border-line bg-white"
      />

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-content-faint">
        <FileText size={12} aria-hidden="true" />
        {planDocument.name} — document PDF, les salles se sélectionnent ci-dessous.
      </p>

      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Salles de ce bâtiment">
        {rooms.map((room) => {
          const status = mineIds.includes(room.id) ? 'mienne' : room.status;
          return (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => onSelect?.(room)}
                aria-pressed={room.id === selectedId}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs transition',
                  TONE[status] ?? TONE.occupee,
                  room.id === selectedId && 'ring-1 ring-accent',
                )}
              >
                {room.name}
                <span className="ml-1.5 text-content-faint">
                  {room.floor} · {status === 'mienne' ? 'Votre salle' : ROOM_STATUS_LABEL[room.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
