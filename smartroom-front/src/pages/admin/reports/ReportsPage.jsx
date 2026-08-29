import { useMemo, useState } from 'react';
import { CalendarClock, Download, LayoutGrid, Timer, UserX } from 'lucide-react';
import { COLONNES_EXPORT, exportReport, getReport } from '../../../api/admin/reports';
import { listBuildings } from '../../../api/buildings';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { KpiTile, KpiTileSkeleton } from '../../../components/stats/KpiTile';
import { BuildingSplit } from '../../../components/admin/reports/BuildingSplit';
import { ExportPanel } from '../../../components/admin/reports/ExportPanel';
import { ReportFilters } from '../../../components/admin/reports/ReportFilters';
import { PeriodHoursChart, TopRoomsChart } from '../../../components/admin/reports/ReportCharts';
import { RoomReportTable } from '../../../components/admin/reports/RoomReportTable';
import { NOW, addDays, startOfMonth, toDateInput } from '../../../utils/dates';
import { fmtPercent, plural } from '../../../utils/format';

const PRESETS = [
  { label: '7 jours', from: toDateInput(addDays(NOW, -7)), to: toDateInput(NOW) },
  { label: '30 jours', from: toDateInput(addDays(NOW, -30)), to: toDateInput(NOW) },
  { label: 'Ce mois-ci', from: toDateInput(startOfMonth(NOW)), to: toDateInput(NOW) },
];

/**
 * Pas d'agrégation adapté à la durée observée.
 *
 * Le rapport partait sur trente jours agrégés *par mois* : un seul seau, donc
 * une seule barre, et un histogramme qui n'apprenait rien. Le pas suit
 * désormais la période — assez de barres pour qu'une tendance se voie, pas
 * assez pour qu'elles se confondent.
 *
 * L'administrateur garde la main : dès qu'il choisit un pas, la période cesse
 * de le recalculer.
 */
function granulariteParDefaut(du, au) {
  const jours = Math.round((new Date(au) - new Date(du)) / 86_400_000);
  if (jours <= 21) return 'day';
  if (jours <= 120) return 'week';
  return 'month';
}

const FILTRES_INITIAUX = {
  from: PRESETS[1].from,
  to: PRESETS[1].to,
  buildingIds: [],
  granularity: granulariteParDefaut(PRESETS[1].from, PRESETS[1].to),
  granulariteChoisie: false,
};

/**
 * A-02 — Statistiques & rapports.
 *
 * Les agrégats viennent tous de la même source que les écrans utilisateur : un
 * rapport et le tableau de bord ne peuvent pas se contredire.
 */
export default function ReportsPage() {
  useDocumentTitle('Statistiques & rapports');
  const [filtres, setFiltres] = useState(FILTRES_INITIAUX);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);
  const toast = useToast();

  const cle = `${filtres.from}|${filtres.to}|${filtres.buildingIds.join(',')}|${filtres.granularity}`;
  const rapport = useAsync(() => getReport(filtres), [cle]);
  const batiments = useAsync(listBuildings, []);

  const colonnes = useMemo(() => COLONNES_EXPORT, []);

  const lancerExport = async ({ format, columns }) => {
    setExportEnCours(true);
    try {
      const fichier = await exportReport({ ...filtres, format, columns });
      setPanneauOuvert(false);
      toast.success(
        'Export généré',
        `${fichier.filename} — ${plural(fichier.rows, 'ligne')}, ${plural(fichier.columns.length, 'colonne')}.`,
      );
    } catch (erreur) {
      toast.error('Export impossible', erreur.message);
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Statistiques & rapports"
        subtitle="Volume, occupation et absentéisme sur la période de votre choix."
        actions={
          <Button
            icon={Download}
            onClick={() => setPanneauOuvert(true)}
            disabled={!rapport.isSuccess}
          >
            Exporter
          </Button>
        }
      />

      <ReportFilters
        value={filtres}
        onChange={(suivants) =>
          setFiltres(
            suivants.granulariteChoisie
              ? suivants
              : {
                  ...suivants,
                  granularity: granulariteParDefaut(suivants.from, suivants.to),
                },
          )
        }
        buildings={batiments.data ?? []}
        presets={PRESETS}
      />

      <AsyncBoundary
        status={rapport.status}
        error={rapport.error}
        onRetry={rapport.reload}
        skeleton={<RapportSkeleton />}
      >
        {rapport.data && (
          <div className="flex flex-col gap-4">
            <Totaux totals={rapport.data.totals} />

            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
              <PeriodHoursChart
                data={rapport.data.byPeriod}
                granularity={rapport.data.granularity}
              />
              <BuildingSplit data={rapport.data.byBuilding} />
            </div>

            <TopRoomsChart data={rapport.data.byRoom} />
            <RoomReportTable rows={rapport.data.byRoom} />
          </div>
        )}
      </AsyncBoundary>

      <ExportPanel
        open={panneauOuvert}
        onClose={() => setPanneauOuvert(false)}
        onExport={lancerExport}
        columns={colonnes}
        filters={filtres}
        rows={rapport.data?.totals.usedRooms ?? 0}
        loading={exportEnCours}
      />
    </div>
  );
}

function Totaux({ totals }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <KpiTile
        icon={CalendarClock}
        tone="accent"
        value={totals.bookings}
        unit={totals.bookings > 1 ? 'réservations' : 'réservation'}
        label="Volume sur la période"
      />
      <KpiTile icon={Timer} value={totals.hours} unit="h" label="Heures réservées" />
      <KpiTile
        icon={LayoutGrid}
        value={totals.usedRooms}
        label={`Salles utilisées sur ${totals.rooms} au catalogue`}
      />
      <KpiTile icon={UserX} value={fmtPercent(totals.noShow)} label="Absences sans annulation" />
    </div>
  );
}

function RapportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {[0, 1, 2, 3].map((index) => (
          <KpiTileSkeleton key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonCard />
    </div>
  );
}
