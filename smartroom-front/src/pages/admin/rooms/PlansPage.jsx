import { useEffect, useState } from 'react';
import { Map } from 'lucide-react';
import { getPlanLayout, listPlans, placeRoom, unplaceRoom } from '../../../api/admin/plans';
import {
  listFloorsWithRooms,
  listManagedBuildings,
} from '../../../api/admin/buildings';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Form';
import { Tabs } from '../../../components/ui/Tabs';
import { LocationPlanBrowser } from '../../../components/admin/rooms/LocationPlanBrowser';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { PlanEditor } from '../../../components/admin/rooms/PlanEditor';
import { PlanRoomPanel } from '../../../components/admin/rooms/PlanRoomPanel';
import { PlanUpload } from '../../../components/rooms/PlanUpload';

/**
 * A-08 — Gestion des plans.
 *
 * Le déplacement est optimiste : la salle suit le curseur immédiatement, et
 * l'API n'est appelée qu'au relâchement. Une requête par pixel parcouru
 * rendrait le glisser inutilisable.
 */
export default function PlansPage() {
  useDocumentTitle('Gestion des plans');
  const toast = useToast();

  const [planId, setPlanId] = useState(null);
  const [selection, setSelection] = useState(null);
  const [vue, setVue] = useState('localisation');
  const [batimentId, setBatimentId] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const plans = useAsync(listPlans, []);
  const parc = useAsync(listManagedBuildings, []);
  const etages = useAsync(
    (options) =>
      batimentId ? listFloorsWithRooms(batimentId, options ?? {}) : Promise.resolve([]),
    [batimentId],
  );
  const layout = useAsync(
    () =>
      planId
        ? getPlanLayout(planId, {
            hasPlan: plans.data?.find((item) => item.id === planId)?.hasPlan ?? true,
          })
        : Promise.resolve(null),
    [planId],
  );

  useEffect(() => {
    if (!planId && plans.data?.length > 0) setPlanId(plans.data[0].id);
  }, [plans.data, planId]);

  // Le premier bâtiment est retenu d'office : un sélecteur vide au chargement
  // obligerait à un choix pour voir ce que l'écran a déjà de quoi montrer.
  useEffect(() => {
    if (!batimentId && parc.data?.length > 0) setBatimentId(parc.data[0].id);
  }, [parc.data, batimentId]);

  const pose = layout.data?.placed.find((item) => item.room.id === selection) ?? null;

  /** Déplacement local, sans requête : le rendu doit suivre le curseur. */
  const bouger = (roomId, position) => {
    layout.setData((current) => ({
      ...current,
      placed: current.placed.map((item) =>
        item.room.id === roomId
          ? { ...item, room: { ...item.room, plan: { ...item.room.plan, ...position } } }
          : item,
      ),
    }));
  };

  const enregistrerPosition = async (roomId, patch = {}) => {
    const cible = layout.data?.placed.find((item) => item.room.id === roomId);
    if (!cible) return;
    setEnvoi(true);
    try {
      await placeRoom(planId, roomId, {
        x: cible.room.plan.x,
        y: cible.room.plan.y,
        rotation: cible.rotation,
        entrance: cible.entrance,
        ...patch,
      });
      layout.setData((current) => ({
        ...current,
        placed: current.placed.map((item) =>
          item.room.id === roomId ? { ...item, ...patch } : item,
        ),
      }));
    } catch (erreur) {
      toast.error('Placement refusé', erreur.message);
      await layout.reload();
    } finally {
      setEnvoi(false);
    }
  };

  const retirer = async () => {
    setEnvoi(true);
    try {
      await unplaceRoom(planId, selection);
      setSelection(null);
      await layout.reload();
    } finally {
      setEnvoi(false);
    }
  };

  const placer = async (roomId) => {
    setEnvoi(true);
    try {
      // Dépôt au centre : la salle est visible d'emblée, puis se déplace.
      await placeRoom(planId, roomId, { x: 40, y: 40, rotation: 0, entrance: false });
      await layout.reload();
      setSelection(roomId);
    } catch (erreur) {
      toast.error('Placement refusé', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const batimentChoisi = (parc.data ?? []).find((item) => item.id === batimentId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        subtitle={
          vue === 'localisation'
            ? 'Les plans de localisation des salles, bâtiment par bâtiment.'
            : 'Plan officiel de l’étage et position des salles telles que les utilisateurs les voient.'
        }
        actions={
          vue === 'localisation' ? (
            <Select
              label="Bâtiment"
              options={(parc.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
              value={batimentId ?? ''}
              onChange={(event) => setBatimentId(event.target.value)}
              className="min-w-[14rem]"
            />
          ) : (
            <Select
              label="Plan"
              options={(plans.data ?? []).map((plan) => ({
                value: plan.id,
                label: `${plan.label} — ${plan.sublabel}`,
              }))}
              value={planId ?? ''}
              onChange={(event) => {
                setPlanId(event.target.value);
                setSelection(null);
              }}
              className="min-w-[16rem]"
            />
          )
        }
      />

      {/* Consulter d'abord, régler ensuite. La page portait le seul éditeur de
          plan d'étage, et les plans de localisation — un par salle, déposés à
          sa création — n'étaient consultables que fiche par fiche : trente
          salles, trente allers-retours pour comparer deux niveaux. */}
      <Tabs
        tabs={[
          { id: 'localisation', label: 'Plans de localisation' },
          { id: 'etage', label: 'Plan d’étage et placement' },
        ]}
        value={vue}
        onChange={setVue}
        label="Vue des plans"
      />

      {vue === 'localisation' && (
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
      )}

      {vue === 'etage' && (
      <AsyncBoundary
        status={planId ? layout.status : 'chargement'}
        error={layout.error}
        onRetry={layout.reload}
        skeleton={<SkeletonCard />}
      >
        {layout.data && (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <div className="flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardHeader
                  title={layout.data.label}
                  subtitle={layout.data.sublabel}
                  icon={Map}
                />
                <div className="px-3 pb-3">
                  <PlanEditor
                    layout={layout.data}
                    selectedId={selection}
                    onSelect={setSelection}
                    onMove={bouger}
                    onCommit={(roomId) => enregistrerPosition(roomId)}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Plan de l’étage"
                  subtitle="Image ou PDF déposé par l’administration, visible par les utilisateurs"
                />
                <div className="px-4 pb-4">
                  <PlanUpload
                    planId={planId}
                    document={layout.data.document}
                    // La liste des plans porte `hasPlan`, qui décide si le
                    // document sera demandé. La recharger d'abord : sans cela,
                    // le plan tout juste déposé resterait invisible, l'écran
                    // le croyant toujours absent.
                    onUploaded={async () => {
                      await plans.reload();
                      await layout.reload();
                    }}
                  />
                </div>
              </Card>
            </div>

            <PlanRoomPanel
              pose={pose}
              unplaced={layout.data.unplaced}
              busy={envoi}
              onRotate={(rotation) => enregistrerPosition(selection, { rotation })}
              onEntrance={(entrance) => enregistrerPosition(selection, { entrance })}
              onUnplace={retirer}
              onPlace={placer}
            />
          </div>
        )}
      </AsyncBoundary>
      )}
    </div>
  );
}
