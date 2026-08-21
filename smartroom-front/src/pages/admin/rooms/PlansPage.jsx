import { useEffect, useState } from 'react';
import { Map } from 'lucide-react';
import { getPlanLayout, listPlans, placeRoom, unplaceRoom } from '../../../api/admin/plans';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Form';
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
  const [envoi, setEnvoi] = useState(false);

  const plans = useAsync(listPlans, []);
  const layout = useAsync(
    () => (planId ? getPlanLayout(planId) : Promise.resolve(null)),
    [planId],
  );

  useEffect(() => {
    if (!planId && plans.data?.length > 0) setPlanId(plans.data[0].id);
  }, [plans.data, planId]);

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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Gestion des plans"
        subtitle="Plan officiel de l’étage et position des salles telles que les utilisateurs les voient."
        actions={
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
        }
      />

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
                    onUploaded={() => layout.reload()}
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
    </div>
  );
}
