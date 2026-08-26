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
  onAttente,
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

  return (
    <PhotosTab
      // En création, les visuels vivent dans le brouillon : ils partiront dès
      // que la salle aura un identifiant.
      photos={creating ? draft.pendingPhotos : draft.photos}
      busy={photoBusy}
      creating={creating}
      locationPlanUrl={
        creating ? draft.pendingLocationPlan?.apercu ?? null : draft.locationPlanUrl
      }
      onAdd={(dataUrl) =>
        creating ? onAttente({ photo: dataUrl }) : onPhoto(() => addRoomPhoto(roomId, dataUrl))
      }
      onRemove={(index) =>
        creating
          ? onAttente({ retirerPhoto: index })
          : onPhoto(() => removeRoomPhoto(roomId, index))
      }
      onCover={(index) =>
        creating ? onAttente({ couverture: index }) : onPhoto(() => setCoverPhoto(roomId, index))
      }
      onUploadPlan={(fichier) =>
        creating
          ? onAttente({ plan: fichier })
          : onPhoto(() => uploadRoomLocationPlan(roomId, fichier))
      }
      onRemovePlan={() =>
        creating ? onAttente({ plan: null }) : onPhoto(() => removeRoomLocationPlan(roomId))
      }
    />
  );
}
