import { ArrowDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtDateLong } from '../../utils/dates';
import { fmtCapacity } from '../../utils/format';
import { Card, CardHeader } from '../ui/Card';

function Block({ label, values, muted = false }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        muted ? 'border-line bg-surface-raised' : 'border-accent/40 bg-accent-soft',
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-content-muted">{label}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {values.map((value) => (
          <li
            key={value.key}
            className={cn(
              'text-sm',
              muted && value.changed && 'text-content-faint line-through',
              !muted && value.changed && 'text-content',
              !value.changed && 'text-content-muted',
              value.mono && 'font-mono text-xs',
            )}
          >
            {value.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** U-10 — comparatif avant / après, seuls les champs modifiés sont barrés. */
export function ChangeSummary({ before, after }) {
  const rows = (source, other) => [
    { key: 'room', label: source.roomName, changed: source.roomName !== other.roomName },
    {
      key: 'date',
      label: fmtDateLong(source.date),
      changed: source.date !== other.date,
    },
    {
      key: 'slot',
      label: `${source.startTime} - ${source.endTime}`,
      mono: true,
      changed: source.startTime !== other.startTime || source.endTime !== other.endTime,
    },
    {
      key: 'attendees',
      label: fmtCapacity(source.attendees),
      changed: String(source.attendees) !== String(other.attendees),
    },
  ];

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader title="Résumé des modifications" />
      <div className="flex flex-col gap-2 px-4 pb-4">
        <Block label="Avant" values={rows(before, after)} muted />
        <span className="flex justify-center text-content-muted" aria-hidden="true">
          <ArrowDown size={16} />
        </span>
        <Block label="Après" values={rows(after, before)} />
      </div>
    </Card>
  );
}
