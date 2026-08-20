import { differenceInMinutes } from 'date-fns';
import { fmtTime, mergeDateAndTime, toDate } from '../../utils/dates';

/**
 * U-12 — visualisation du chevauchement : la demande et l'existant sont posés
 * sur une même échelle horaire, ce qui rend le conflit lisible d'un coup d'œil.
 */
export function ConflictTimeline({ requested, existing = [] }) {
  const day = toDate(requested.start);
  const scaleStart = mergeDateAndTime(day, '08:00');
  const scaleEnd = mergeDateAndTime(day, '20:00');
  const total = differenceInMinutes(scaleEnd, scaleStart);

  const bar = (start, end) => {
    const from = Math.max(0, differenceInMinutes(toDate(start), scaleStart));
    const width = Math.max(1, differenceInMinutes(toDate(end), toDate(start)));
    return { left: `${(from / total) * 100}%`, width: `${(width / total) * 100}%` };
  };

  const hours = ['08:00', '11:00', '14:00', '17:00', '20:00'];

  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] text-content-muted">
        {hours.map((hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>

      <div className="relative mt-2 h-9 rounded-lg border border-line bg-surface-raised">
        {existing.map((booking) => (
          <span
            key={booking.id}
            title={`${booking.title} ${fmtTime(booking.start)}-${fmtTime(booking.end)}`}
            className="absolute top-1 h-3 rounded-full bg-danger/70"
            style={bar(booking.start, booking.end)}
          />
        ))}
        <span
          className="absolute bottom-1 h-3 rounded-full bg-accent"
          style={bar(requested.start, requested.end)}
        />
      </div>

      <div className="mt-2 flex gap-4 text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          Votre demande {fmtTime(requested.start)}-{fmtTime(requested.end)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-danger/70" aria-hidden="true" />
          Réservations existantes
        </span>
      </div>
    </div>
  );
}
