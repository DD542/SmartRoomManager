import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ShieldAlert } from 'lucide-react';
import { fmtDateLong, fmtTime } from '../../utils/dates';
import { openingLabel } from '../../utils/openingRules';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, Callout } from '../ui/Card';
import { Spinner } from '../ui/States';

/**
 * Clé d'un conflit dans la liste.
 *
 * L'écran lisait `conflit.booking.id` — la forme des maquettes. L'adaptateur
 * rend `bookingId`, une chaîne, et rien d'autre : le premier conflit affiché
 * emportait donc tout le tunnel sur « Cannot read properties of undefined ».
 * Le défaut ne se voyait que sur un créneau en conflit, c'est-à-dire
 * exactement quand cet écran sert à quelque chose.
 *
 * `bookingId` est absent des conflits qui n'opposent aucune réservation — une
 * fermeture, un battement contre une plage close : la sorte et le créneau
 * complètent donc la clé.
 */
const cle = (conflit) =>
  [conflit.kind, conflit.bookingId ?? 'sans-reservation', conflit.start?.toISOString?.() ?? '']
    .join('|');

/**
 * U-04 — rail droit : créneau retenu, verdict du moteur de conflits,
 * alternatives cliquables et règles d'accès de la salle.
 */
export function SlotPanel({
  slot,
  rules,
  checking,
  conflicts = [],
  alternatives = [],
  ruleErrors = [],
  ruleWarnings = [],
  canBook,
  recurring = false,
  onPickAlternative,
  onContinue,
}) {
  const blocking = conflicts.filter((conflict) => conflict.blocking);
  const soft = conflicts.filter((conflict) => !conflict.blocking);
  const closedDay = ruleErrors.some((error) => error.code === 'jour_ferme');

  return (
    <Card className="flex flex-col lg:sticky lg:top-4">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <CalendarClock size={15} aria-hidden="true" className="text-accent" />
        <h2 className="text-sm font-semibold text-content">Détails de la réservation</h2>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-content-muted">Créneau sélectionné</p>
          <p className="mt-1 text-sm capitalize text-content">{fmtDateLong(slot.start)}</p>
          <p className="mt-1.5 inline-flex rounded-lg border border-line bg-surface-raised px-2.5 py-1 font-mono text-sm text-content">
            {fmtTime(slot.start)} - {fmtTime(slot.end)}
          </p>
        </div>

        {checking && <Spinner label="Vérification du créneau…" />}

        {!checking && ruleErrors.map((error) => (
          <Callout key={error.code} tone="danger" icon={ShieldAlert} title="Créneau refusé">
            {error.message}
          </Callout>
        ))}

        {!checking && blocking.map((conflict) => (
          <Callout key={cle(conflict)} tone="danger" icon={AlertTriangle} title="Conflit détecté">
            {conflict.message}
          </Callout>
        ))}

        {!checking && soft.map((conflict) => (
          <Callout key={cle(conflict)} tone="warning" icon={AlertTriangle} title="Conflit potentiel">
            {conflict.message}
          </Callout>
        ))}

        {!checking && ruleWarnings.map((warning) => (
          <Callout key={warning} tone="warning">
            {warning}
          </Callout>
        ))}

        {!checking && alternatives.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-content-muted">Créneaux alternatifs</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {alternatives.map((alternative) => (
                <button
                  key={alternative.start.toISOString()}
                  type="button"
                  onClick={() => onPickAlternative(alternative)}
                  className="rounded-lg border border-line bg-surface-raised px-2.5 py-1 font-mono text-xs text-content transition hover:border-accent"
                >
                  {fmtTime(alternative.start)} - {fmtTime(alternative.end)}
                </button>
              ))}
            </div>
          </div>
        )}

        {!checking && canBook && (
          <Callout tone="success" icon={CheckCircle2}>
            Créneau disponible, aucun conflit détecté.
          </Callout>
        )}

        {rules && (
          <div className="border-t border-line pt-4">
            <p className="text-xs uppercase tracking-wide text-content-muted">Règles d’accès</p>
            <p className="mt-2 flex items-center gap-2 text-xs text-content-muted">
              <Badge tone="default">{openingLabel(rules)}</Badge>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {rules.constraints.map((constraint) => (
                <li key={constraint} className="flex gap-2 text-xs text-content-muted">
                  <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                  {constraint}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="mt-auto flex flex-col gap-2 border-t border-line px-4 py-3">
        {closedDay && (
          <Button variant="secondary" size="sm" fullWidth to="/app/reservation/acces-exceptionnel">
            Demander un accès exceptionnel
          </Button>
        )}
        {blocking.length > 0 && (
          <Button variant="secondary" size="sm" fullWidth to="/app/reservation/conflit">
            Résoudre le conflit
          </Button>
        )}
        {recurring && (
          <Button variant="secondary" size="sm" fullWidth to="/app/reservation/recurrente">
            Configurer la récurrence
          </Button>
        )}
        <Button fullWidth iconRight={ArrowRight} disabled={!canBook || checking} onClick={onContinue}>
          Continuer
        </Button>
      </footer>
    </Card>
  );
}
