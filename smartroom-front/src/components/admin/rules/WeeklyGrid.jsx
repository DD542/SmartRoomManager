import { cn } from '../../../utils/cn';
import { Card, CardHeader } from '../../ui/Card';
import { Switch } from '../../ui/Form';

/**
 * A-09 — grille hebdomadaire d'ouverture.
 *
 * Chaque ligne est enregistrée immédiatement : ce sont sept réglages
 * indépendants, pas un formulaire à valider d'un bloc.
 */
export function WeeklyGrid({ days = [], onChange, busy = false }) {
  return (
    <Card>
      <CardHeader
        title="Grille hebdomadaire"
        subtitle="Amplitude d’ouverture appliquée à toutes les salles, sauf surcharge."
      />
      <ul className="flex flex-col divide-y divide-line px-4 pb-4">
        {days.map((jour) => (
          <li
            key={jour.day}
            className={cn(
              'flex flex-wrap items-center gap-3 py-3',
              !jour.open && 'text-content-faint',
            )}
          >
            <span className="w-24 shrink-0 text-sm text-content">{jour.label}</span>

            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-content-muted">
                <span className="sr-only">Ouverture le {jour.label}</span>
                <input
                  type="time"
                  value={jour.openTime}
                  disabled={!jour.open || busy}
                  onChange={(event) => onChange(jour.day, { openTime: event.target.value })}
                  className="h-8 rounded-lg border border-line bg-surface-raised px-2 font-mono text-xs text-content disabled:opacity-40 focus:border-accent focus:outline-none"
                />
              </label>
              <span aria-hidden="true" className="text-content-faint">
                →
              </span>
              <label className="flex items-center gap-1.5 text-xs text-content-muted">
                <span className="sr-only">Fermeture le {jour.label}</span>
                <input
                  type="time"
                  value={jour.closeTime}
                  disabled={!jour.open || busy}
                  onChange={(event) => onChange(jour.day, { closeTime: event.target.value })}
                  className="h-8 rounded-lg border border-line bg-surface-raised px-2 font-mono text-xs text-content disabled:opacity-40 focus:border-accent focus:outline-none"
                />
              </label>
            </span>

            <span className="ml-auto">
              <Switch
                hideLabel
                label={`Ouvert le ${jour.label.toLowerCase()}`}
                checked={jour.open}
                onChange={() => onChange(jour.day, { open: !jour.open })}
              />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
