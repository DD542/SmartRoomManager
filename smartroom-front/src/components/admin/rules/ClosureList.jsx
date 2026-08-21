import { CalendarCheck2, Trash2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Card, CardHeader } from '../../ui/Card';
import { IconButton } from '../../ui/Button';
import { EmptyState } from '../../ui/States';
import { fmtDate, NOW, toDate } from '../../../utils/dates';

/**
 * A-09 — fermetures déclarées.
 *
 * Les périodes passées restent visibles mais estompées : elles expliquent
 * l'historique des réservations sans encombrer la lecture des dates à venir.
 */
export function ClosureList({ closures = [], onRemove, busy = false }) {
  if (closures.length === 0) {
    return (
      <Card>
        <CardHeader title="Fermetures exceptionnelles" />
        <div className="px-4 pb-4">
          <EmptyState
            icon={CalendarCheck2}
            title="Aucune fermeture déclarée"
            description="L’établissement suit la grille hebdomadaire toute l’année."
          />
        </div>
      </Card>
    );
  }

  const triees = [...closures].sort((a, b) => toDate(a.from) - toDate(b.from));

  return (
    <Card>
      <CardHeader
        title="Fermetures exceptionnelles"
        subtitle={`${closures.length} période(s) déclarée(s)`}
      />
      <ul className="flex flex-col divide-y divide-line px-4 pb-4">
        {triees.map((closure) => {
          const passee = toDate(closure.to) < NOW;
          return (
            <li
              key={closure.id}
              className={`flex flex-wrap items-center gap-3 py-3 ${passee ? 'opacity-50' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">{closure.label}</span>
                <span className="block font-mono text-[11px] text-content-faint">
                  {closure.from === closure.to
                    ? fmtDate(closure.from)
                    : `${fmtDate(closure.from)} → ${fmtDate(closure.to)}`}
                  {' · '}
                  {closure.scopeLabel}
                </span>
              </span>

              <Badge tone={closure.kind === 'ferme' ? 'danger' : 'warning'} dot>
                {closure.kind === 'ferme' ? 'Fermeture' : 'Exception'}
              </Badge>

              <IconButton
                icon={Trash2}
                label={`Retirer « ${closure.label} »`}
                disabled={busy}
                onClick={() => onRemove(closure.id)}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
