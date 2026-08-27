import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  addRoomPhoto,
  createRoom,
  getManagedRoom,
  listRoomFilters,
  saveRoomAvailability,
  updateRoom,
  uploadRoomLocationPlan,
} from '../../../api/admin/rooms';
import { equipmentCategories, listEquipmentCatalog } from '../../../api/admin/equipment';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card } from '../../../components/ui/Card';
import { Tabs } from '../../../components/ui/Tabs';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { SaveBar } from '../../../components/admin/SaveBar';
import { incoherences } from '../../../components/admin/rooms/AvailabilityTab';
import { RoomTabPanels } from '../../../components/admin/rooms/RoomTabPanels';
import { RoomPreview } from '../../../components/admin/rooms/RoomPreview';
import {
  SALLE_VIERGE,
  validerSalle,
  versBrouillon,
} from '../../../components/admin/rooms/roomDraft';

// `Tabs` identifie ses onglets par `id`, pas par `value` : la bascule reste
// muette si la clé ne correspond pas.
const ONGLETS = [
  { id: 'general', label: 'Général' },
  { id: 'equipements', label: 'Équipements' },
  { id: 'acces', label: 'Accès' },
  { id: 'disponibilite', label: 'Disponibilité' },
  { id: 'photos', label: 'Visuels' },
];

/**
 * A-06 — Création et édition d'une salle.
 *
 * Un seul écran pour les deux cas : `/admin/salles/nouvelle` part d'un
 * brouillon vierge, les photos n'étant gérées qu'une fois la salle créée
 * puisqu'elles s'attachent à un identifiant.
 */
export default function RoomEditPage() {
  const { id } = useParams();
  const creation = id === 'nouvelle';
  const naviguer = useNavigate();
  const toast = useToast();

  const [onglet, setOnglet] = useState('general');
  const [draft, setDraft] = useState(SALLE_VIERGE);
  const [enregistrement, setEnregistrement] = useState(false);
  const [photoEnCours, setPhotoEnCours] = useState(false);

  const salle = useAsync(
    () => (creation ? Promise.resolve(null) : getManagedRoom(id)),
    [id],
  );
  const referentiels = useAsync(listRoomFilters, []);
  const catalogue = useAsync(listEquipmentCatalog, []);
  const categories = useMemo(equipmentCategories, []);

  useDocumentTitle(creation ? 'Nouvelle salle' : (salle.data?.name ?? 'Salle'));

  useEffect(() => {
    if (salle.data) setDraft(versBrouillon(salle.data));
  }, [salle.data]);

  const modifier = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const reference = salle.data ? versBrouillon(salle.data) : SALLE_VIERGE;
  const modifie = JSON.stringify(draft) !== JSON.stringify(reference);
  const alertes = incoherences(draft.rules);
  const erreurs = validerSalle(draft);
  const valide = alertes.length === 0 && Object.keys(erreurs).length === 0;

  /**
   * Visuels choisis avant que la salle existe.
   *
   * Un fichier s'attache à un identifiant, et il n'y en a pas encore : ils
   * attendent dans le brouillon, puis partent juste après la création. Exiger
   * d'enregistrer d'abord obligeait à revenir sur ses pas pour finir une fiche
   * qu'on croyait terminée.
   */
  const enAttente = (ordre) =>
    setDraft((courant) => {
      if ('photo' in ordre) {
        return { ...courant, pendingPhotos: [...courant.pendingPhotos, ordre.photo] };
      }
      if ('retirerPhoto' in ordre) {
        return {
          ...courant,
          pendingPhotos: courant.pendingPhotos.filter((_, i) => i !== ordre.retirerPhoto),
        };
      }
      if ('couverture' in ordre) {
        const choisie = courant.pendingPhotos[ordre.couverture];
        return {
          ...courant,
          pendingPhotos: [
            choisie,
            ...courant.pendingPhotos.filter((_, i) => i !== ordre.couverture),
          ],
        };
      }
      if ('plan' in ordre) {
        // L'aperçu local est révoqué en même temps que le fichier qu'il
        // décrit : un `blob:` laissé derrière retient sa donnée en mémoire
        // jusqu'au rechargement de l'onglet.
        if (courant.pendingLocationPlan?.apercu) {
          URL.revokeObjectURL(courant.pendingLocationPlan.apercu);
        }
        return {
          ...courant,
          pendingLocationPlan: ordre.plan
            ? { fichier: ordre.plan, apercu: URL.createObjectURL(ordre.plan) }
            : null,
        };
      }
      return courant;
    });

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      if (creation) {
        const creee = await createRoom(draft);

        // Les visuels retenus partent maintenant que la salle a un
        // identifiant. Un échec ici ne défait pas la création : la salle
        // existe, et l'écran de détail permet de reprendre le dépôt.
        const manques = [];
        for (const dataUrl of draft.pendingPhotos) {
          try {
            await addRoomPhoto(creee.id, dataUrl);
          } catch {
            manques.push('une photo');
          }
        }
        // Les horaires et les durées de la salle, que `createRoom` ne porte
        // pas : ils vivent dans une autre portée côté serveur.
        try {
          await saveRoomAvailability(creee.id, draft.rules);
        } catch {
          manques.push('la disponibilité');
        }

        if (draft.pendingLocationPlan) {
          try {
            await uploadRoomLocationPlan(creee.id, draft.pendingLocationPlan.fichier);
          } catch {
            manques.push('le plan de localisation');
          }
        }

        if (manques.length > 0) {
          toast.error(
            'Salle créée, visuels incomplets',
            `${creee.name} existe, mais ${manques.join(' et ')} n’a pas pu être déposé.`,
          );
        } else {
          toast.success('Salle créée', `${creee.name} est désormais réservable.`);
        }
        naviguer(`/admin/salles/${creee.id}`, { replace: true });
        return;
      }
      await updateRoom(id, draft);
      // L'onglet « Disponibilité » modifiait un brouillon que rien n'envoyait :
      // on changeait les horaires, l'écran annonçait « enregistrée », et rien
      // ne bougeait.
      await saveRoomAvailability(id, draft.rules);
      toast.success('Salle enregistrée', `${draft.name} a été mise à jour.`);
      await salle.reload();
    } catch (erreur) {
      toast.error('Enregistrement impossible', erreur.message);
    } finally {
      setEnregistrement(false);
    }
  };

  const surPhoto = async (action) => {
    setPhotoEnCours(true);
    try {
      const majour = await action();
      setDraft((current) => ({
        ...current,
        photos: majour.photos,
        locationPlanUrl: majour.locationPlanUrl ?? null,
      }));
      salle.setData(majour);
    } catch (erreur) {
      toast.error('Visuel refusé', erreur.message);
    } finally {
      setPhotoEnCours(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backTo="/admin/salles"
        backLabel="Retour au catalogue"
        title={creation ? 'Nouvelle salle' : (draft.name || 'Salle')}
        subtitle={
          creation
            ? 'Photos et plan de localisation se joignent dès maintenant : ils partiront avec la salle.'
            : 'Chaque modification est répercutée immédiatement côté utilisateur.'
        }
      />

      <AsyncBoundary
        status={creation ? 'succes' : salle.status}
        error={salle.error}
        onRetry={salle.reload}
        skeleton={<SkeletonCard />}
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <div className="border-b border-line px-3 pt-3">
              <Tabs tabs={ONGLETS} value={onglet} onChange={setOnglet} label="Sections de la salle" />
            </div>
            <div className="p-4">
              <RoomTabPanels
                tab={onglet}
                draft={draft}
                onChange={modifier}
                errors={erreurs}
                buildings={referentiels.data?.buildings ?? []}
                floors={referentiels.data?.floors ?? []}
                catalog={catalogue.data ?? []}
                categories={categories}
                creating={creation}
                photoBusy={photoEnCours}
                onPhoto={surPhoto}
                onAttente={enAttente}
                roomId={id}
              />
            </div>
          </Card>

          <RoomPreview
            draft={draft}
            buildings={referentiels.data?.buildings ?? []}
            catalog={catalogue.data ?? []}
          />
        </div>
      </AsyncBoundary>

      <SaveBar
        dirty={modifie || creation}
        saving={enregistrement}
        valid={valide}
        message={alertes[0] ?? Object.values(erreurs)[0]}
        saveLabel={creation ? 'Créer la salle' : 'Enregistrer les modifications'}
        onCancel={() => (creation ? naviguer('/admin/salles') : setDraft(reference))}
        onSave={enregistrer}
      />
    </div>
  );
}
