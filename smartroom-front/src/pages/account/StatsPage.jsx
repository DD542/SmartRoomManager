import { useEffect, useState } from 'react';
import { CalendarCheck, Clock, Download, Lightbulb, UserCheck, XCircle } from 'lucide-react';
import { exportStats, getMyStats } from '../../api/stats';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { fmtPercent } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/Tabs';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { KpiTile, KpiTileSkeleton } from '../../components/stats/KpiTile';
import { HoursBarChart, RoomDonutChart, SlotDistribution } from '../../components/stats/StatCharts';

const PERIODS = [
  { value: 'mois', label: 'Ce mois' },
  { value: 'trimestre', label: 'Ce trimestre' },
  { value: 'annee', label: 'Cette année' },
];

/** U-24 — Mes statistiques d'occupation. */
export default function StatsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState('trimestre');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    document.title = 'Mes statistiques — SmartRoom Manager';
  }, []);

  const stats = useAsync(() => getMyStats(period, user.id), [period, user.id]);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const result = await exportStats(period);
      toast.success('Export prêt', `Le rapport ${result.filename} a été généré.`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mes statistiques"
        actions={
          <>
            <SegmentedControl label="Période" options={PERIODS} value={period} onChange={setPeriod} />
            <Button icon={Download} loading={exporting} onClick={exportPdf}>
              Exporter en PDF
            </Button>
          </>
        }
      />

      <AsyncBoundary
        status={stats.status}
        error={stats.error}
        onRetry={stats.reload}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <div className="grid gap-3 sm:grid-cols-4 [&>*]:min-w-0">
              {Array.from({ length: 4 }, (_, index) => (
                <KpiTileSkeleton key={index} />
              ))}
            </div>
            <Skeleton className="h-56 w-full" />
          </div>
        }
      >
        {stats.data && (
          <>
            <Callout tone="accent" icon={Lightbulb} title="Observation">
              {stats.data.observation}
            </Callout>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
              <KpiTile
                icon={CalendarCheck}
                tone="accent"
                value={stats.data.kpis.bookings}
                label="réservations totales"
              />
              <KpiTile icon={Clock} value={stats.data.kpis.hours} unit="h" label="heures réservées" />
              <KpiTile
                icon={XCircle}
                value={stats.data.kpis.cancelled}
                label={stats.data.kpis.cancelled > 1 ? 'annulations' : 'annulation'}
              />
              <KpiTile
                icon={UserCheck}
                value={fmtPercent(stats.data.kpis.attendance)}
                label="taux de présence"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <HoursBarChart data={stats.data.byMonth} />
              <RoomDonutChart data={stats.data.byRoom} />
            </div>

            <SlotDistribution data={stats.data.bySlot} />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
