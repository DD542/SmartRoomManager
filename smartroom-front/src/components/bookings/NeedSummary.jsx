import { Building2, CalendarDays, ListChecks, Monitor, Users } from 'lucide-react';
import { fmtDateShort } from '../../utils/dates';
import { plural } from '../../utils/format';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/States';

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-2.5 last:border-0">
      <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-content-muted" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-content-muted">{label}</p>
        <div className="mt-0.5 text-sm text-content">{children}</div>
      </div>
    </div>
  );
}

/**
 * U-02 — rail droit : le besoin se reformule en direct, et le nombre de salles
 * compatibles est recalculé à chaque modification.
 */
export function NeedSummary({ draft, building, equipment = [], matches, isCounting }) {
  const selected = equipment.filter((item) => draft.equipmentIds.includes(item.id));

  return (
    <Card className="lg:sticky lg:top-4">
      <p className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-content-muted">
        Résumé de la recherche
      </p>

      <Row icon={ListChecks} label="Objet">
        {draft.title?.trim() || <span className="text-content-faint">À renseigner</span>}
      </Row>
      <Row icon={Building2} label="Bâtiment">
        {building?.name ?? 'Tous les bâtiments'}
      </Row>
      <Row icon={CalendarDays} label="Date & heure">
        <span>{draft.date ? fmtDateShort(draft.date) : '—'}</span>
        <span className="ml-2 font-mono text-accent">
          {draft.startTime} - {draft.endTime}
        </span>
      </Row>
      <Row icon={Users} label="Capacité requise">
        {plural(Number(draft.attendees) || 0, 'personne')}
        {draft.accessible && <span className="ml-2 text-xs text-content-muted">• accès PMR</span>}
      </Row>
      <Row icon={Monitor} label="Équipements">
        {selected.length === 0 ? (
          <span className="text-content-faint">Aucun imposé</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {selected.map((item) => (
              <span
                key={item.id}
                className="rounded-lg border border-line bg-surface-raised px-2 py-0.5 text-xs text-content-muted"
              >
                {item.label}
              </span>
            ))}
          </span>
        )}
      </Row>

      <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-xs text-content-muted">Résultats estimés</span>
        {isCounting ? (
          <Spinner label="Calcul…" className="text-xs" />
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <span
              className={`h-1.5 w-1.5 rounded-full ${matches > 0 ? 'bg-success' : 'bg-danger'}`}
              aria-hidden="true"
            />
            <span className="font-mono text-content">{matches}</span>
            <span className="text-content-muted">{matches > 1 ? 'salles' : 'salle'}</span>
          </span>
        )}
      </footer>
    </Card>
  );
}
