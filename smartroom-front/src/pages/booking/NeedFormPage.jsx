import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { listBuildings } from '../../api/buildings';
import { listEquipment } from '../../api/equipment';
import { listRooms } from '../../api/rooms';
import { useAsync } from '../../hooks/useAsync';
import { useBooking } from '../../hooks/useBooking';
import { durationMin, mergeDateAndTime } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Card';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeedSummary } from '../../components/bookings/NeedSummary';
import {
  ConfigurationSection,
  EquipmentSection,
  WhereWhenSection,
} from '../../components/bookings/NeedFormSections';

/**
 * U-02 — Formulaire de besoin, étape 1 du tunnel.
 * Le brouillon peut être amorcé par la recherche rapide du dashboard,
 * transmise par l'état de navigation plutôt que par l'URL.
 */
export default function NeedFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { draft, update, commit } = useBooking();
  const [error, setError] = useState(null);

  const buildings = useAsync(listBuildings, []);
  const equipment = useAsync(listEquipment, []);

  useEffect(() => {
    document.title = 'Nouvelle réservation — SmartRoom Manager';
    if (location.state?.draft) update(location.state.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = useMemo(
    () => ({
      capacity: Number(draft.attendees) || 0,
      building: draft.buildingId,
      equipment: draft.equipmentIds,
      accessible: draft.accessible,
    }),
    [draft.attendees, draft.buildingId, draft.equipmentIds, draft.accessible],
  );

  const matches = useAsync(() => listRooms(filters), [filters]);

  const minutes = durationMin(
    mergeDateAndTime(draft.date, draft.startTime),
    mergeDateAndTime(draft.date, draft.endTime),
  );

  const onSubmit = (event) => {
    event.preventDefault();
    if (minutes <= 0) {
      setError('L’heure de fin doit suivre l’heure de début.');
      return;
    }
    if (!draft.attendees || Number(draft.attendees) < 1) {
      setError('Indiquez au moins une personne.');
      return;
    }
    setError(null);
    commit();
    // La récurrence se configure après le choix de la salle : le moteur a besoin
    // d'une salle pour qualifier chaque occurrence.
    navigate('/app/reservation/salles');
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <PageHeader
        title="Nouvelle réservation"
        subtitle="Définissez vos besoins pour trouver la salle idéale."
      />

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <WhereWhenSection
            draft={draft}
            update={update}
            buildings={buildings.data ?? []}
            minutes={minutes}
          />
          <ConfigurationSection draft={draft} update={update} />
          <EquipmentSection draft={draft} update={update} equipment={equipment.data ?? []} />
          {error && <Callout tone="danger">{error}</Callout>}
        </div>

        <NeedSummary
          draft={draft}
          building={(buildings.data ?? []).find((b) => b.id === draft.buildingId)}
          equipment={equipment.data ?? []}
          matches={(matches.data ?? []).length}
          isCounting={matches.isLoading}
        />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <Button variant="ghost" to="/app">
          Annuler
        </Button>
        <Button type="submit" size="lg" iconRight={ArrowRight}>
          Voir les salles disponibles
        </Button>
      </footer>
    </form>
  );
}
