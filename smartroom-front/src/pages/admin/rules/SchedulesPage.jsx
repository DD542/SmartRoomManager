import { useState } from 'react';
import { CalendarOff } from 'lucide-react';
import {
  addClosure,
  getSchedule,
  getYearOverview,
  listClosures,
  removeClosure,
  updateScheduleDay,
} from '../../../api/admin/schedules';
import { listBuildings } from '../../../api/buildings';
import { listRoomFilters } from '../../../api/admin/rooms';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { ClosureList } from '../../../components/admin/rules/ClosureList';
import { ClosureModal } from '../../../components/admin/rules/ClosureModal';
import { WeeklyGrid } from '../../../components/admin/rules/WeeklyGrid';
import { YearOverview } from '../../../components/admin/rules/YearOverview';
import { NOW } from '../../../utils/dates';

const ANNEE = NOW.getFullYear();

/**
 * A-09 — Calendriers d'ouverture et fermetures.
 *
 * La grille hebdomadaire s'enregistre jour par jour ; les fermetures sont des
 * périodes déclarées à part, qui viennent la surcharger.
 */
export default function SchedulesPage() {
  useDocumentTitle('Calendriers d’ouverture');
  const toast = useToast();

  const [ajout, setAjout] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const grille = useAsync(getSchedule, []);
  const fermetures = useAsync(listClosures, []);
  const apercu = useAsync(() => getYearOverview(ANNEE), []);
  const batiments = useAsync(listBuildings, []);
  const referentiels = useAsync(listRoomFilters, []);

  const modifierJour = async (day, patch) => {
    setEnvoi(true);
    try {
      const majour = await updateScheduleDay(day, patch);
      grille.setData(majour);
    } catch (erreur) {
      toast.error('Horaire refusé', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const declarer = async (form) => {
    setEnvoi(true);
    try {
      await addClosure(form);
      toast.success('Fermeture déclarée', form.label);
      setAjout(false);
      await Promise.all([fermetures.reload(), apercu.reload()]);
    } catch (erreur) {
      toast.error('Déclaration refusée', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const retirer = async (id) => {
    setEnvoi(true);
    try {
      await removeClosure(id);
      await Promise.all([fermetures.reload(), apercu.reload()]);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Calendriers d’ouverture"
        subtitle="Amplitude hebdomadaire et périodes de fermeture de l’établissement."
        actions={
          <Button icon={CalendarOff} onClick={() => setAjout(true)}>
            Déclarer une fermeture
          </Button>
        }
      />

      <AsyncBoundary
        status={grille.status}
        error={grille.error}
        onRetry={grille.reload}
        skeleton={<SkeletonCard />}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <WeeklyGrid days={grille.data?.days ?? []} onChange={modifierJour} busy={envoi} />
            <ClosureList
              closures={fermetures.data ?? []}
              onRemove={retirer}
              busy={envoi}
            />
          </div>

          <YearOverview
            year={ANNEE}
            days={apercu.data?.days ?? {}}
            closures={fermetures.data ?? []}
          />
        </div>
      </AsyncBoundary>

      <ClosureModal
        open={ajout}
        onClose={() => setAjout(false)}
        onSubmit={declarer}
        buildings={(batiments.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
        rooms={referentiels.data?.rooms ?? []}
        loading={envoi}
      />
    </div>
  );
}
