import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Building2 } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { fmtPercent } from '../../../utils/format';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';
import { SLICES } from '../../charts/theme';

/**
 * A-02 — part de chaque bâtiment dans le volume réservé.
 *
 * Même parti pris que les statistiques utilisateur : pas d'infobulle flottante
 * qui masque le compteur central, mais une légende qui se met à jour au survol
 * comme au focus clavier.
 */
export function BuildingSplit({ data = [], className }) {
  const [actif, setActif] = useState(null);
  const total = data.reduce((somme, entree) => somme + entree.bookings, 0);
  const survole = actif === null ? null : data[actif];

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader title="Répartition par bâtiment" />
        <div className="px-4 pb-4">
          <EmptyState
            icon={Building2}
            title="Aucun bâtiment concerné"
            description="Aucune réservation ne tombe dans la période retenue."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader title="Répartition par bâtiment" subtitle={`${total} réservation(s) au total`} />
      <div className="flex flex-col items-center gap-4 px-4 pb-4 sm:flex-row">
        <div className="relative h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="bookings"
                nameKey="label"
                innerRadius={52}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
                // Décrit par la légende : sorti du parcours clavier pour ne pas
                // afficher un cadre de focus sur le SVG.
                tabIndex={-1}
                onMouseEnter={(_, index) => setActif(index)}
                onMouseLeave={() => setActif(null)}
              >
                {data.map((entree, index) => (
                  <Cell
                    key={entree.id}
                    fill={SLICES[index % SLICES.length]}
                    fillOpacity={actif === null || actif === index ? 1 : 0.3}
                    style={{ transition: 'fill-opacity 180ms', cursor: 'pointer' }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
            aria-live="polite"
          >
            <span className="font-mono text-xl text-content">
              {survole ? fmtPercent(survole.bookings / (total || 1)) : data.length}
            </span>
            <span className="mt-0.5 text-[11px] leading-tight text-content-muted">
              {survole ? survole.label : 'bâtiments'}
            </span>
          </div>
        </div>

        <ul className="w-full flex-1">
          {data.map((entree, index) => (
            <li key={entree.id} className="border-b border-line last:border-0">
              <button
                type="button"
                onMouseEnter={() => setActif(index)}
                onMouseLeave={() => setActif(null)}
                onFocus={() => setActif(index)}
                onBlur={() => setActif(null)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-xs transition',
                  actif === index ? 'bg-surface-raised' : 'bg-transparent',
                )}
              >
                <span className="flex items-center gap-2 text-content-muted">
                  <span
                    className="h-2 w-2 rounded-sm transition-transform"
                    style={{
                      background: SLICES[index % SLICES.length],
                      transform: actif === index ? 'scale(1.4)' : 'none',
                    }}
                    aria-hidden="true"
                  />
                  {entree.label}
                </span>
                <span className="font-mono text-content">{entree.hours} h</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
