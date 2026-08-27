import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NOW, toDateInput } from '../utils/dates';

const BookingContext = createContext(null);

/** Brouillon du tunnel de réservation (U-02 → U-06). */
const emptyDraft = {
  title: '',
  // Aucune préférence de bâtiment au départ, et surtout pas `b-a` : cet
  // identifiant venait des maquettes. Le parc réel ne le connaît pas, et
  // l'API refusait la recherche — « Le bâtiment doit être un identifiant
  // valide » — alors que l'écran affichait « Tous les bâtiments », faute de
  // trouver ce bâtiment pour en montrer le nom.
  buildingId: '',
  date: toDateInput(NOW),
  startTime: '14:00',
  endTime: '15:30',
  attendees: 8,
  equipmentIds: [],
  accessible: false,
  recurring: false,
  roomId: null,
  room: null,
  participants: [],
  notifyConfirmation: true,
  notifyReminder: true,
};

/**
 * Le brouillon ne transite jamais par l'URL : les étapes 2 à 4 se protègent en
 * vérifiant `hasDraft`, et redirigent vers l'étape 1 si le contexte est vide.
 */
export function BookingProvider({ children }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const update = useCallback((patch) => {
    setTouched(true);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  /**
   * Valide l'étape 1 sans rien modifier : un utilisateur qui accepte tous les
   * réglages par défaut doit pouvoir avancer, alors qu'aucun champ n'a bougé.
   */
  const commit = useCallback(() => setTouched(true), []);

  const selectRoom = useCallback(
    (room) => update({ roomId: room?.id ?? null, room: room ?? null }),
    [update],
  );

  const reset = useCallback(() => {
    setDraft(emptyDraft);
    setTouched(false);
    setLastResult(null);
  }, []);

  const value = useMemo(
    () => ({
      draft,
      update,
      commit,
      selectRoom,
      reset,
      touched,
      hasDraft: touched,
      hasRoom: Boolean(draft.roomId),
      lastResult,
      setLastResult,
      need: {
        attendees: Number(draft.attendees) || 0,
        equipmentIds: draft.equipmentIds,
        buildingId: draft.buildingId,
        accessible: draft.accessible,
      },
    }),
    [draft, update, commit, selectRoom, reset, touched, lastResult],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error('useBooking doit être utilisé dans un BookingProvider.');
  return context;
}
