import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader } from '../../ui/Card';
import { Skeleton } from '../../ui/States';
import { ACCENT, AXIS, chartMargin, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from '../../charts/theme';

/**
 * A-01 — courbe d'occupation du parc sur la fenêtre choisie.
 *
 * Le taux affiché est le rapport entre les heures réservées et l'amplitude
 * d'ouverture de toutes les salles exploitables : il descend donc réellement à
 * zéro les jours creux, contrairement à une moyenne lissée.
 */
export function OccupancyTrend({ data = [], days = 7 }) {
  return (
    <Card>
      <CardHeader
        title="Occupation du parc"
        subtitle={`Heures réservées rapportées à l’amplitude d’ouverture, sur ${days} jours`}
      />
      <div className="h-60 px-2 pb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={chartMargin}>
            <defs>
              <linearGradient id="grad-occupation" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2C3850" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} minTickGap={12} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={AXIS}
              width={38}
              domain={[0, 100]}
              unit="%"
            />
            <Tooltip
              cursor={{ stroke: '#3B4A66', strokeWidth: 1 }}
              offset={14}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              separator=" "
              formatter={(value, _name, entry) => [
                `${value} % — ${entry.payload.hours} h sur ${entry.payload.bookings} réservation(s)`,
                '',
              ]}
            />
            {/* Animation désactivée : la carte est mesurée après son affichage,
                et Recharts laisse la série vide si l'animation démarre alors que
                le conteneur a encore une largeur nulle. */}
            <Area
              type="monotone"
              dataKey="occupation"
              name="Occupation"
              stroke={ACCENT}
              strokeWidth={2}
              fill="url(#grad-occupation)"
              dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function OccupancyTrendSkeleton() {
  return (
    <Card>
      <CardHeader title="Occupation du parc" />
      <div className="px-4 pb-4">
        <Skeleton className="h-52 w-full" />
      </div>
    </Card>
  );
}
