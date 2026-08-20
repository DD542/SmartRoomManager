import { AlertTriangle, CalendarRange } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtDateShort, fmtTime } from '../../utils/dates';
import { Badge } from '../ui/Badge';
import { Card, CardHeader, Callout } from '../ui/Card';
import { Skeleton } from '../ui/States';

/** U-14 — aperçu des occurrences générées, avec le verdict du moteur de conflits. */
export function RecurrencePreview({ occurrences = [], isLoading, onResolve }) {
  const conflicts = occurrences.filter((occurrence) => !occurrence.available);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Aperçu des dates générées"
        icon={CalendarRange}
        action={<Badge tone="default">{occurrences.length} occurrences</Badge>}
      />

      <div className="flex flex-col gap-2 px-4 pb-4">
        {conflicts.length > 0 && (
          <Callout
            tone="danger"
            icon={AlertTriangle}
            title={`Attention : ${conflicts.length} conflit${conflicts.length > 1 ? 's' : ''} détecté${conflicts.length > 1 ? 's' : ''}`}
            action={
              onResolve && (
                <button
                  type="button"
                  onClick={onResolve}
                  className="shrink-0 rounded-lg border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10"
                >
                  Résoudre
                </button>
              )
            }
          >
            Certaines dates chevauchent des réservations existantes ; elles seront ignorées à la
            création.
          </Callout>
        )}

        {isLoading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!isLoading && (
          <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto pr-1">
            {occurrences.map((occurrence) => (
              <li
                key={occurrence.index}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-surface-raised px-3 py-2.5',
                  occurrence.available ? 'border-line' : 'border-l-2 border-l-danger border-line',
                )}
              >
                <span className="w-7 shrink-0 font-mono text-xs text-content-faint">
                  #{occurrence.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm capitalize text-content">
                    {fmtDateShort(occurrence.start)}
                  </span>
                  <span className="block font-mono text-xs text-content-muted">
                    {fmtTime(occurrence.start)} - {fmtTime(occurrence.end)}
                  </span>
                  {!occurrence.available && occurrence.reason && (
                    <span className="mt-0.5 block text-xs text-danger">{occurrence.reason}</span>
                  )}
                </span>
                <Badge tone={occurrence.available ? 'success' : 'danger'} dot>
                  {occurrence.available ? 'Disponible' : 'Conflit'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
