import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';
import { BarChart3 } from 'lucide-react';
import {
  ACCENT,
  AXIS,
  chartMargin,
  hoverCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from '../../charts/theme';

const infobulle = (formatter) => (
  <Tooltip
    cursor={hoverCursor}
    offset={14}
    contentStyle={tooltipStyle}
    labelStyle={tooltipLabelStyle}
    itemStyle={tooltipItemStyle}
    separator=" "
    formatter={formatter}
  />
);

/** A-02 — heures réservées par pas de temps (jour ou mois selon le filtre). */
export function PeriodHoursChart({ data = [], granularity = 'mois' }) {
  return (
    <Card>
      <CardHeader
        title="Heures réservées"
        subtitle={granularity === 'jour' ? 'Agrégées par jour' : 'Agrégées par mois'}
      />
      {data.length === 0 ? (
        <Vide />
      ) : (
        <div className="h-56 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={chartMargin}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} minTickGap={8} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={32}
                allowDecimals={false}
              />
              {infobulle((value) => [`${value} h réservées`, ''])}
              {/* Animation désactivée : le conteneur est mesuré après le premier
                  rendu, et Recharts laisserait les barres vides. */}
              <Bar
                dataKey="hours"
                radius={[6, 6, 0, 0]}
                maxBarSize={56}
                fill={ACCENT}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/**
 * A-02 — salles les plus demandées.
 *
 * Barres horizontales : les noms de salle tiennent en toutes lettres, là où un
 * axe vertical les tronquerait ou les ferait pivoter.
 */
export function TopRoomsChart({ data = [], limit = 6 }) {
  const retenues = data.filter((salle) => salle.bookings > 0).slice(0, limit);

  return (
    <Card>
      <CardHeader title="Salles les plus demandées" subtitle="Volume de réservations sur la période" />
      {retenues.length === 0 ? (
        <Vide />
      ) : (
        <div className="px-2 pb-4" style={{ height: Math.max(160, retenues.length * 38 + 24) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={retenues} layout="vertical" margin={{ ...chartMargin, left: 8 }}>
              <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="room"
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={104}
              />
              {infobulle((value, _name, entry) => [
                `${value} réservation(s) — ${entry.payload.hours} h`,
                '',
              ])}
              <Bar dataKey="bookings" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={false}>
                {retenues.map((salle, index) => (
                  // La salle en tête est pleine, les suivantes restent lisibles
                  // mais en retrait : le classement se lit sans compter.
                  <Cell key={salle.roomId} fill={ACCENT} fillOpacity={index === 0 ? 1 : 0.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Vide() {
  return (
    <div className="px-4 pb-4">
      <EmptyState
        icon={BarChart3}
        title="Aucune donnée sur cette période"
        description="Élargissez les dates ou retirez un filtre de bâtiment."
      />
    </div>
  );
}
