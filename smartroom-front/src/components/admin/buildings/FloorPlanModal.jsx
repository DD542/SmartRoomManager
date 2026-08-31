import { useState } from 'react';
import { Map } from 'lucide-react';
import { getPlanLayout, placeRoom, unplaceRoom } from '../../../api/admin/plans';
import { useAsync } from '../../../hooks/useAsync';
import { useToast } from '../../../hooks/useToast';
import { Button } from '../../ui/Button';
import { CardHeader } from '../../ui/Card';
import { Modal } from '../../ui/Modal';
import { AsyncBoundary, SkeletonCard } from '../../ui/States';
import { PlanEditor } from '../rooms/PlanEditor';
import { PlanRoomPanel } from '../rooms/PlanRoomPanel';
import { PlanUpload } from '../../rooms/PlanUpload';

/**
 * Plan d'un étage et position de ses salles.
 *
 * L'éditeur vivait sur l'écran des plans, devenu un écran de consultation. Il
 * n'a pas disparu pour autant : les positions qu'il règle sont celles que les
 * utilisateurs voient sur `/app/plan`, et les figer aurait retiré à
 * l'administration la seule façon de corriger un plan.
 *
 * Il est ici parce que les niveaux se gèrent ici. En modale plutôt qu'en
 * section : régler une géométrie demande de la place, et l'accordéon des
 * étages en manque.
 *
 * Le déplacement est optimiste — la salle suit le curseur, l'API n'est appelée
 * qu'au relâchement. Une requête par pixel parcouru rendrait le glisser
 * inutilisable.
 */
export function FloorPlanModal({ floor, open, onClose, onChanged }) {
  const toast = useToast();
  const [selection, setSelection] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const layout = useAsync(
    () => (floor ? getPlanLayout(floor.id, { hasPlan: floor.hasPlan ?? true }) : Promise.resolve(null)),
    [floor?.id],
  );

  const pose = layout.data?.placed.find((item) => item.room.id === selection) ?? null;

  /**
   * Déplacement local, sans requête : le rendu doit suivre le curseur.
   *
   * La géométrie est écrite dans `room.plan`, là où l'éditeur la lit. Écrite
   * à côté — dans `pose.x` — elle partait bien au serveur mais ne s'affichait
   * jamais : la salle restait immobile pendant que sa position changeait.
   */
  const bouger = (roomId, position) => {
    layout.setData((courant) => ({
      ...courant,
      placed: courant.placed.map((item) =>
        item.room.id === roomId
          ? { ...item, room: { ...item.room, plan: { ...item.room.plan, ...position } } }
          : item,
      ),
    }));
  };

  const enregistrer = async (roomId, patch = {}) => {
    const cible = layout.data?.placed.find((item) => item.room.id === roomId);
    if (!cible) return;

    setEnvoi(true);
    try {
      await placeRoom(floor.id, roomId, {
        // `patch` porte la geometrie que l'editeur vient de calculer quand
        // elle vient d'un deplacement : l'etat local ne l'a pas encore recue.
        x: cible.room.plan.x,
        y: cible.room.plan.y,
        rotation: cible.rotation,
        entrance: cible.entrance,
        ...patch,
      });
      // Seul le correctif est réappliqué localement : recharger apres chaque
      // touche de direction rendrait le deplacement au clavier saccade.
      layout.setData((courant) => ({
        ...courant,
        placed: courant.placed.map((item) =>
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

  // Une modale ne protège pas son propre contenu : les enfants sont construits
  // **ici**, par l'appelant, et passés déjà évalués. `Modal` rend `null` quand
  // elle est fermée, mais bien trop tard — l'arbre a été bâti avant.
  //
  // Le corps ci-dessous ne s'affichait que si `layout.data` existait, et ces
  // données survivent à la fermeture : refermer le plan lisait donc `floor.id`
  // sur `null`, et l'écran des bâtiments entier tombait sur l'écran d'erreur du
  // routeur. La sortie porte sur l'étage, seul sujet de cette modale.
  if (!open || !floor) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      icon={Map}
      title={`Plan — ${floor.label}`}
      description="Glissez une salle pour la déplacer, ou sélectionnez-la et utilisez les flèches. Le placement s’aligne sur une grille de 2 %."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <AsyncBoundary
        status={layout.status}
        error={layout.error}
        onRetry={layout.reload}
        skeleton={<SkeletonCard />}
      >
        {layout.data && (
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem] [&>*]:min-w-0">
            <div className="flex flex-col gap-4">
              <PlanEditor
                layout={layout.data}
                selectedId={selection}
                onSelect={setSelection}
                onMove={bouger}
                onCommit={(roomId, position) => enregistrer(roomId, position ?? {})}
              />

              <div className="rounded-xl border border-line bg-surface-raised p-3">
                <CardHeader
                  title="Image du plan"
                  subtitle="Déposée par l’administration, visible par les utilisateurs"
                  className="px-0 py-0 pb-2"
                />
                <PlanUpload
                  planId={floor.id}
                  document={layout.data.document}
                  onUploaded={async () => {
                    // `hasPlan` décide si le document est demandé : sans ce
                    // rafraîchissement, le plan tout juste déposé resterait
                    // invisible, l'écran le croyant toujours absent.
                    await onChanged?.();
                    await layout.reload();
                  }}
                />
              </div>
            </div>

            <PlanRoomPanel
              pose={pose}
              unplaced={layout.data.unplaced}
              busy={envoi}
              onRotate={(rotation) => enregistrer(selection, { rotation })}
              onEntrance={(entrance) => enregistrer(selection, { entrance })}
              onUnplace={async () => {
                setEnvoi(true);
                try {
                  await unplaceRoom(floor.id, selection);
                  setSelection(null);
                  await layout.reload();
                } finally {
                  setEnvoi(false);
                }
              }}
              onPlace={async (roomId) => {
                setEnvoi(true);
                try {
                  // Dépôt au centre : la salle est visible d'emblée, puis se
                  // déplace.
                  await placeRoom(floor.id, roomId, {
                    x: 40,
                    y: 40,
                    rotation: 0,
                    entrance: false,
                  });
                  await layout.reload();
                  setSelection(roomId);
                } catch (erreur) {
                  toast.error('Placement refusé', erreur.message);
                } finally {
                  setEnvoi(false);
                }
              }}
            />
          </div>
        )}
      </AsyncBoundary>
    </Modal>
  );
}
