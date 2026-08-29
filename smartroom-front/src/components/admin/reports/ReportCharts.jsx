import {
  Bar,
  BarChart,
  Cell,
  LabelList,
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
const PAS_AGREGATION = {
  day: 'Agrégées par jour',
  week: 'Agrégées par semaine',
  month: 'Agrégées par mois',
};

export function PeriodHoursChart({ data = [], granularity = 'month' }) {
  return (
    <Card>
      <CardHeader
        title="Heures réservées"
        // Le sous-titre suit la granularité réelle. Il ne connaissait que
        // « jour » et « mois » : la semaine s'y annonçait comme un mois, et le
        // graphique décrivait faussement ce qu'il montrait.
        subtitle={PAS_AGREGATION[granularity] ?? 'Agrégées par période'}
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
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                allowDecimals={false}
                // L'espace à droite laisse place au chiffre de la barre la plus
                // longue, qui sortirait sinon du cadre.
                domain={[0, (maximum) => Math.ceil((maximum * 1.08) / 10) * 10]}
              />
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
                  // Cinq crans d'opacité plutôt que deux : « la première pleine,
                  // les autres à moitié » ne distinguait pas la deuxième de la
                  // sixième.
                  <Cell
                    key={salle.roomId}
                    fill={ACCENT}
                    fillOpacity={1 - Math.min(index, 4) * 0.16}
                  />
                ))}
                {/* Le chiffre au bout de chaque barre. Les salles les plus
                    demandées se tiennent en quelques réservations — 46 contre
                    42 sur une échelle qui monte à 60 : les barres se
                    ressemblent, et sans valeur écrite, le graphique ne se lit
                    pas du tout. */}
                <LabelList
                  dataKey="bookings"
                  position="right"
                  offset={8}
                  fill="#B4C0D4"
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                />
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
