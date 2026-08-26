import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createRoom, getManagedRoom, listRoomFilters, updateRoom } from '../../../api/admin/rooms';
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
  { id: 'photos', label: 'Photos' },
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

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      if (creation) {
        const creee = await createRoom(draft);
        toast.success('Salle créée', `${creee.name} est désormais réservable.`);
        naviguer(`/admin/salles/${creee.id}`, { replace: true });
        return;
      }
      await updateRoom(id, draft);
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
      setDraft((current) => ({ ...current, photos: majour.photos }));
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
            ? 'Les visuels pourront être ajoutés une fois la salle créée.'
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
