import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useState } from 'react';
import { cn } from '../../utils/cn';
import { fmtPercent } from '../../utils/format';
import { Card, CardHeader } from '../ui/Card';
import {
  AXIS,
  SLICES,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from '../charts/theme';

/** U-24 — heures réservées par mois. */
export function HoursBarChart({ data = [] }) {
  return (
    <Card>
      <CardHeader title="Heures réservées par mois" />
      <div className="h-56 px-2 pb-4">
        <ResponsiveContainer width="100%" height="100%">
          {/* Marges positives uniquement : une marge négative fait calculer à
              Recharts une largeur de bande nulle, et plus aucune barre ne sort. */}
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} width={32} allowDecimals={false} />
            <Tooltip
              // Bande de survol arrondie et discrète : sans arrondi ni retrait,
              // elle se lit comme une seconde barre posée derrière la vraie.
              cursor={{ fill: 'rgba(91,155,255,0.07)', radius: 8 }}
              offset={14}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              separator=" "
              formatter={(value) => [`${value} h réservées`, '']}
            />
            {/* Animation désactivée : la carte est mesurée après son affichage,
                et Recharts laisse les barres vides si l'animation démarre alors
                que le conteneur a encore une largeur nulle. */}
            <Bar dataKey="hours" radius={[6, 6, 0, 0]} maxBarSize={64} isAnimationActive={false}>
              {data.map((entry, index) => (
                // Le mois courant est plein, les précédents restent lisibles mais en retrait.
                <Cell
                  key={entry.label}
                  fill="#5B9BFF"
                  fillOpacity={index === data.length - 1 ? 1 : 0.45}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/**
 * U-24 — répartition des réservations par salle.
 *
 * Au survol d'une part — ou d'une ligne de légende — la salle correspondante
 * s'affiche au centre du donut plutôt que dans une infobulle flottante : le
 * compteur central sert de légende, rien ne vient recouvrir le graphe.
 * Les lignes de légende sont des boutons, donc la même lecture est disponible
 * au clavier.
 */
export function RoomDonutChart({ data = [] }) {
  const [active, setActive] = useState(null);
  const total = data.reduce((sum, entry) => sum + entry.count, 0);
  const highlighted = active !== null ? data[active] : null;

  return (
    <Card>
      <CardHeader title="Répartition par salle" />
      <div className="flex flex-col items-center gap-4 px-4 pb-4 sm:flex-row">
        <div className="relative h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={52}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
                // Le donut est décrit par la légende : on le sort du parcours
                // clavier pour ne pas afficher un cadre de focus sur le SVG.
                tabIndex={-1}
                onMouseEnter={(_, index) => setActive(index)}
                onMouseLeave={() => setActive(null)}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.roomId}
                    fill={SLICES[index % SLICES.length]}
                    fillOpacity={active === null || active === index ? 1 : 0.3}
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
            {highlighted ? (
              <>
                <span className="font-mono text-xl text-content">
                  {fmtPercent(highlighted.count / (total || 1))}
                </span>
                <span className="mt-0.5 text-[11px] leading-tight text-content-muted">
                  {highlighted.name}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-xl text-content">{data.length}</span>
                <span className="text-xs text-content-muted">salles</span>
              </>
            )}
          </div>
        </div>

        <ul className="w-full flex-1">
          {data.map((entry, index) => (
            <li key={entry.roomId} className="border-b border-line last:border-0">
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-xs transition',
                  active === index ? 'bg-surface-raised' : 'bg-transparent',
                )}
              >
                <span className="flex items-center gap-2 text-content-muted">
                  <span
                    className="h-2 w-2 rounded-sm transition-transform"
                    style={{
                      background: SLICES[index % SLICES.length],
                      transform: active === index ? 'scale(1.4)' : 'none',
                    }}
                    aria-hidden="true"
                  />
                  {entry.name}
                </span>
                <span className="font-mono text-content">
                  {fmtPercent(entry.count / (total || 1))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** U-24 — créneaux préférés, en barres horizontales. */
export function SlotDistribution({ data = [] }) {
  const max = Math.max(...data.map((entry) => entry.share), 0.01);

  return (
    <Card>
      <CardHeader title="Créneaux préférés" />
      <ul className="flex flex-col gap-3 px-4 pb-4">
        {data.map((slot) => {
          const leading = slot.share === max && slot.share > 0;
          return (
            <li key={slot.id} className="flex items-center gap-3">
              <span className="w-24 shrink-0 font-mono text-xs text-content-muted">{slot.label}</span>
              <span className="h-4 flex-1 overflow-hidden rounded-md bg-surface-raised">
                <span
                  className={`flex h-full items-center justify-end rounded-md px-2 ${
                    leading ? 'bg-accent' : 'bg-line-strong'
                  }`}
                  style={{ width: `${Math.max(4, (slot.share / max) * 100)}%` }}
                >
                  {leading && <span className="text-[10px] text-white">Le plus utilisé</span>}
                </span>
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-xs text-content">
                {fmtPercent(slot.share)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
