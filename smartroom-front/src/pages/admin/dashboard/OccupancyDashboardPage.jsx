import { useState } from 'react';
import { BarChart3, CalendarRange, GaugeCircle, ShieldAlert, UserX } from 'lucide-react';
import { getOverview } from '../../../api/admin/reports';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { SegmentedControl } from '../../../components/ui/Tabs';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { KpiTile, KpiTileSkeleton } from '../../../components/stats/KpiTile';
import { PermissionGate } from '../../../components/admin/PermissionGate';
import { AlertList } from '../../../components/admin/dashboard/AlertList';
import { HourHeatmap } from '../../../components/admin/dashboard/HourHeatmap';
import {
  OccupancyTrend,
  OccupancyTrendSkeleton,
} from '../../../components/admin/dashboard/OccupancyTrend';
import { fmtPercent } from '../../../utils/format';

const FENETRES = [
  { value: 7, label: '7 jours' },
  { value: 14, label: '14 jours' },
  { value: 30, label: '30 jours' },
];

/**
 * A-01 — Tableau de bord d'occupation.
 *
 * Tout est recalculé depuis le magasin de réservations : créer, annuler ou
 * arbitrer déplace immédiatement les indicateurs de cet écran.
 */
export default function OccupancyDashboardPage() {
  useDocumentTitle('Tableau de bord');
  const [jours, setJours] = useState(7);
  const { data, status, error, reload } = useAsync(() => getOverview(jours), [jours]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tableau de bord"
        subtitle="Occupation du parc, points d’attention et densité horaire."
        actions={
          <>
            <SegmentedControl
              label="Fenêtre d’analyse"
              options={FENETRES}
              value={jours}
              onChange={setJours}
            />
            {/* Sans la permission d'export, le lien mènerait à un écran de
                refus : autant ne pas le proposer. */}
            <PermissionGate permission="data.export">
              <Button variant="secondary" size="sm" icon={BarChart3} to="/admin/rapports">
                Rapports détaillés
              </Button>
            </PermissionGate>
          </>
        }
      />

      <AsyncBoundary
        status={status}
        error={error}
        onRetry={reload}
        skeleton={<DashboardSkeleton />}
      >
        {data && (
          <div className="flex flex-col gap-4">
            <Indicateurs kpis={data.kpis} deltas={data.deltas} jours={jours} />

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
              <OccupancyTrend data={data.trend} days={jours} />
              <AlertList alerts={data.alerts} />
            </div>

            <HourHeatmap heatmap={data.heatmap} />
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}

/** Les quatre chiffres clés, chacun comparé à la période précédente si c'est calculable. */
function Indicateurs({ kpis, deltas, jours }) {
  const ecartVolume = deltas?.periodBookings ?? 0;
  const ecartNoShow = deltas?.noShowRate ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <KpiTile
        icon={GaugeCircle}
        tone="accent"
        value={fmtPercent(kpis.occupancyRate)}
        label="Occupation moyenne des salles exploitables"
      />
      <KpiTile
        icon={CalendarRange}
        value={kpis.periodBookings}
        unit={kpis.periodBookings > 1 ? 'réservations' : 'réservation'}
        label={`Sur ${jours} jours`}
        trend={
          ecartVolume === 0
            ? { direction: 'flat', label: 'stable' }
            : {
                direction: ecartVolume > 0 ? 'up' : 'down',
                tone: ecartVolume > 0 ? 'good' : 'neutral',
                label: `${ecartVolume > 0 ? '+' : ''}${ecartVolume}`,
              }
        }
      />
      <KpiTile
        icon={ShieldAlert}
        value={kpis.pendingConflicts}
        label={`À arbitrer — ${kpis.resolvedConflicts} déjà traité(s)`}
      />
      <KpiTile
        icon={UserX}
        value={fmtPercent(kpis.noShowRate)}
        label="Absences sans annulation"
        trend={
          Math.abs(ecartNoShow) < 0.005
            ? { direction: 'flat', label: 'stable' }
            : {
                // Une hausse du no-show est une mauvaise nouvelle : la flèche
                // suit la variation, la couleur suit son interprétation.
                direction: ecartNoShow > 0 ? 'up' : 'down',
                tone: ecartNoShow > 0 ? 'bad' : 'good',
                label: `${ecartNoShow > 0 ? '+' : ''}${fmtPercent(ecartNoShow)}`,
              }
        }
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {[0, 1, 2, 3].map((index) => (
          <KpiTileSkeleton key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <OccupancyTrendSkeleton />
        <SkeletonCard />
      </div>
      <SkeletonCard />
    </div>
  );
}
