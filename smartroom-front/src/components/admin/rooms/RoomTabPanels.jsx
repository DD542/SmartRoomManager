import {
  addRoomPhoto,
  removeRoomLocationPlan,
  removeRoomPhoto,
  setCoverPhoto,
  uploadRoomLocationPlan,
} from '../../../api/admin/rooms';
import { AccessTab } from './AccessTab';
import { AvailabilityTab } from './AvailabilityTab';
import { EquipmentTab } from './EquipmentTab';
import { GeneralTab } from './GeneralTab';
import { PhotosTab } from './PhotosTab';

/**
 * A-06 — aiguillage des cinq onglets de la fiche salle.
 *
 * Isolé de la page pour qu'elle ne porte que l'état du brouillon et son
 * enregistrement ; chaque onglet reste un composant de formulaire autonome.
 */
export function RoomTabPanels({
  tab,
  draft,
  onChange,
  errors,
  buildings,
  floors,
  catalog,
  categories,
  creating,
  photoBusy,
  onPhoto,
  roomId,
}) {
  if (tab === 'general') {
    return (
      <GeneralTab
        draft={draft}
        onChange={onChange}
        buildings={buildings}
        floors={floors}
        errors={errors}
      />
    );
  }
  if (tab === 'equipements') {
    return (
      <EquipmentTab draft={draft} onChange={onChange} catalog={catalog} categories={categories} />
    );
  }
  if (tab === 'acces') return <AccessTab draft={draft} onChange={onChange} />;
  if (tab === 'disponibilite') return <AvailabilityTab draft={draft} onChange={onChange} />;

  // Les visuels s'attachent à un identifiant : ils n'existent qu'après création.
  if (creating) {
    return (
      <p className="text-sm text-content-muted">
        Les visuels s’attachent à une salle existante : enregistrez d’abord la salle, l’onglet
        s’activera ensuite.
      </p>
    );
  }

  return (
    <PhotosTab
      photos={draft.photos}
      busy={photoBusy}
      creating={creating}
      locationPlanUrl={draft.locationPlanUrl}
      onAdd={(dataUrl) => onPhoto(() => addRoomPhoto(roomId, dataUrl))}
      onRemove={(index) => onPhoto(() => removeRoomPhoto(roomId, index))}
      onCover={(index) => onPhoto(() => setCoverPhoto(roomId, index))}
      onUploadPlan={(fichier) => onPhoto(() => uploadRoomLocationPlan(roomId, fichier))}
      onRemovePlan={() => onPhoto(() => removeRoomLocationPlan(roomId))}
    />
  );
}
