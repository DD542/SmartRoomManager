import { AlertTriangle, Clock3, Gauge, ScrollText, Users } from 'lucide-react';
import { Card, CardHeader } from '../../ui/Card';
import { Skeleton } from '../../ui/States';

const LIGNES = [
  { id: 'resume', icon: ScrollText },
  { id: 'quota', icon: Gauge },
  { id: 'battement', icon: Users },
  { id: 'avertissement', icon: Clock3, tone: 'warning' },
];

/**
 * A-10 — encart d'impact.
 *
 * Chaque phrase est construite par l'API à partir des valeurs saisies : elle
 * change à chaque frappe, aucune n'est écrite en dur. C'est la traduction en
 * français de ce que l'utilisateur constatera au moment de réserver.
 */
export function ImpactPanel({ impact, loading = false, conflit }) {
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader
        title="Ce que cela change"
        subtitle="Effet des règles sur l’espace utilisateur"
      />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {conflit && (
          <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-xs text-content">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            {conflit}
          </p>
        )}

        {loading && !impact ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : (
          impact &&
          LIGNES.map(({ id, icon: Icone, tone }) => (
            <p
              key={id}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                tone === 'warning'
                  ? 'border-warning/40 bg-warning-soft text-content'
                  : 'border-line bg-surface-raised text-content-muted'
              }`}
            >
              <Icone
                size={14}
                aria-hidden="true"
                className={`mt-0.5 shrink-0 ${tone === 'warning' ? 'text-warning' : 'text-content-faint'}`}
              />
              {impact[id]}
            </p>
          ))
        )}
      </div>
    </Card>
  );
}
