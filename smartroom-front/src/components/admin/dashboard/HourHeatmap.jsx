import { useState } from 'react';
import { cn } from '../../../utils/cn';
import { WEEK_DAYS } from '../../../utils/dates';
import { plural } from '../../../utils/format';
import { Card, CardHeader } from '../../ui/Card';

/**
 * A-01 — densité d'occupation par jour ouvré et par heure.
 *
 * Rendue en vrai tableau : les lecteurs d'écran annoncent « Mardi, 14 h,
 * 2 réservations » sans dépendre de la couleur, qui ne porte ici qu'un rappel.
 * La légende de la cellule survolée s'affiche au-dessus plutôt qu'en infobulle
 * flottante, pour rester lisible au clavier comme à la souris.
 */
export function HourHeatmap({ heatmap, className }) {
  const [survolee, setSurvolee] = useState(null);
  const { hours = [], days = [], cells = [] } = heatmap ?? {};

  const cellule = (day, hour) => cells.find((item) => item.day === day && item.hour === hour);
  const libelleJour = (value) => WEEK_DAYS.find((jour) => jour.value === value)?.label ?? '';

  return (
    <Card className={className}>
      <CardHeader
        title="Densité horaire"
        subtitle="Réservations par jour ouvré et par heure"
        action={
          <p className="text-xs text-content-muted" aria-live="polite">
            {survolee
              ? `${libelleJour(survolee.day)} ${survolee.hour} h — ${plural(survolee.value, 'réservation')}`
              : 'Survolez une case'}
          </p>
        }
      />

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-[520px] border-separate border-spacing-1 text-xs">
          <caption className="sr-only">
            Nombre de réservations par jour de la semaine et par heure d’ouverture
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <span className="sr-only">Jour</span>
              </th>
              {hours.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="pb-1 font-mono text-[10px] font-normal text-content-faint"
                >
                  {hour}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <th
                  scope="row"
                  className="pr-1 text-right text-[11px] font-normal text-content-muted"
                >
                  {libelleJour(day).slice(0, 3)}
                </th>
                {hours.map((hour) => {
                  const item = cellule(day, hour) ?? { value: 0, ratio: 0 };
                  const actif = survolee?.day === day && survolee?.hour === hour;
                  return (
                    <td key={hour} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() => setSurvolee({ day, hour, value: item.value })}
                        onMouseLeave={() => setSurvolee(null)}
                        onFocus={() => setSurvolee({ day, hour, value: item.value })}
                        onBlur={() => setSurvolee(null)}
                        className={cn(
                          'h-7 w-full rounded-md border transition duration-200',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                          item.value === 0
                            ? 'border-line/60 bg-surface-raised/40'
                            : 'border-accent/30',
                          actif && 'ring-1 ring-accent',
                        )}
                        style={
                          item.value > 0
                            ? { background: `rgba(91,155,255,${0.18 + item.ratio * 0.62})` }
                            : undefined
                        }
                      >
                        <span className="sr-only">
                          {libelleJour(day)} {hour} h : {plural(item.value, 'réservation')}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <Legende />
      </div>
    </Card>
  );
}

function Legende() {
  return (
    <p className="mt-3 flex items-center gap-2 text-[11px] text-content-faint">
      Faible
      {[0.18, 0.35, 0.52, 0.68, 0.8].map((niveau) => (
        <span
          key={niveau}
          aria-hidden="true"
          className="h-3 w-5 rounded-sm border border-accent/30"
          style={{ background: `rgba(91,155,255,${niveau})` }}
        />
      ))}
      Forte
    </p>
  );
}
