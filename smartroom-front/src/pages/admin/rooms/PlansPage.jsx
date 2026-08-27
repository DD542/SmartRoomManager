import { useEffect, useState } from 'react';
import { listFloorsWithRooms, listManagedBuildings } from '../../../api/admin/buildings';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Select } from '../../../components/ui/Form';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { LocationPlanBrowser } from '../../../components/admin/rooms/LocationPlanBrowser';

/**
 * A-08 — Plans de localisation des salles.
 *
 * Un écran de consultation, et rien d'autre. Chaque salle porte son plan —
 * l'image annotée déposée à sa création, celle que l'utilisateur consulte pour
 * trouver son chemin — et ils n'étaient visibles que fiche par fiche : trente
 * salles, trente allers-retours pour comparer deux niveaux.
 *
 * Le placement des salles sur le plan d'étage, qui vivait ici, a rejoint
 * l'écran des bâtiments : c'est là que les niveaux se gèrent, et régler une
 * géométrie n'est pas le même geste que consulter un repère.
 */
export default function PlansPage() {
  useDocumentTitle('Plans de localisation');

  const [batimentId, setBatimentId] = useState(null);

  const parc = useAsync(listManagedBuildings, []);
  const etages = useAsync(
    (options) =>
      batimentId ? listFloorsWithRooms(batimentId, options ?? {}) : Promise.resolve([]),
    [batimentId],
  );

  // Le premier bâtiment est retenu d'office : un sélecteur vide au chargement
  // obligerait à un choix pour voir ce que l'écran a déjà de quoi montrer.
  useEffect(() => {
    if (!batimentId && parc.data?.length > 0) setBatimentId(parc.data[0].id);
  }, [parc.data, batimentId]);

  const batimentChoisi = (parc.data ?? []).find((item) => item.id === batimentId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans de localisation"
        subtitle="Où se trouve chaque salle, bâtiment par bâtiment."
        actions={
          parc.data && (
            <Select
              label="Bâtiment"
              options={parc.data.map((item) => ({ value: item.id, label: item.name }))}
              value={batimentId ?? ''}
              onChange={(event) => setBatimentId(event.target.value)}
              className="min-w-[16rem]"
            />
          )
        }
      />

      <AsyncBoundary
        status={batimentId ? etages.status : parc.status}
        error={etages.error ?? parc.error}
        onRetry={etages.reload}
        skeleton={<SkeletonCard />}
      >
        <LocationPlanBrowser
          floors={etages.data ?? []}
          buildingName={batimentChoisi?.name ?? ''}
        />
      </AsyncBoundary>
    </div>
  );
}
