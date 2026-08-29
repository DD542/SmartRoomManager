import { useState } from 'react';
import { format, isSameMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../../../utils/cn';
import { monthGrid, toDateInput } from '../../../utils/dates';
import { Card, CardHeader } from '../../ui/Card';

// Clés alignées sur `ClosureKind` de l'API : « fermeture », pas « ferme ».
// Sous l'ancienne clé, `TONS[kind]` valait `undefined` — la case gardait le
// fond de la carte et recevait quand même `text-ink` : une journée de
// fermeture s'affichait en encre sur surface, à 1,29:1, donc invisible.
const TONS = {
  fermeture: 'bg-danger/70 border-danger',
  exception: 'bg-warning/70 border-warning',
};

/**
 * A-09 — aperçu annuel des fermetures.
 *
 * Douze grilles mensuelles compactes : l'année entière tient à l'écran, ce
 * qu'une liste de dates ne permet pas. La légende du jour survolé s'affiche
 * dans l'en-tête plutôt qu'en infobulle flottante, comme ailleurs dans l'app.
 */
export function YearOverview({ year, days = {}, closures = [] }) {
  const [survole, setSurvole] = useState(null);

  const motifDuJour = (iso) =>
    closures.find((closure) => iso >= closure.from && iso <= closure.to)?.label ?? null;

  return (
    <Card>
      <CardHeader
        title={`Aperçu ${year}`}
        subtitle="Fermetures et exceptions déclarées"
        action={
          <p className="text-xs text-content-muted" aria-live="polite">
            {survole ? `${survole.date} — ${survole.motif}` : 'Survolez un jour marqué'}
          </p>
        }
      />

      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
        {Array.from({ length: 12 }, (_, mois) => {
          const reference = new Date(Number(year), mois, 1);
          return (
            <div key={mois} className="rounded-xl border border-line bg-surface-raised p-2.5">
              <p className="mb-1.5 text-[11px] capitalize text-content-muted">
                {format(reference, 'MMMM', { locale: fr })}
              </p>
              <div className="grid grid-cols-7 gap-0.5">
                {monthGrid(reference).map((jour) => {
                  const iso = toDateInput(jour);
                  const kind = days[iso];
                  const horsMois = !isSameMonth(jour, reference);
                  return (
                    <span
                      key={iso}
                      onMouseEnter={
                        kind
                          ? () =>
                              setSurvole({
                                date: format(jour, 'd MMMM', { locale: fr }),
                                motif: motifDuJour(iso) ?? kind,
                              })
                          : undefined
                      }
                      onMouseLeave={kind ? () => setSurvole(null) : undefined}
                      title={kind ? (motifDuJour(iso) ?? kind) : undefined}
                      className={cn(
                        'flex h-4 items-center justify-center rounded-[3px] border text-[8px] font-mono',
                        horsMois && 'opacity-25',
                        kind
                          ? `${TONS[kind]} text-ink`
                          // `content-muted` et non `faint` : sur `line/40` la
                          // teinte faible ne donnait que 4,43:1 à 8 px.
                          : 'border-transparent bg-line/40 text-content-muted',
                      )}
                    >
                      {format(jour, 'd')}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded border', TONS.ferme)} />
          Fermeture
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded border', TONS.exception)} />
          Exception
        </span>
      </p>
    </Card>
  );
}
