import { useState } from 'react';
import {
  cancelAdminBooking,
  cancelBookings,
  createAdminBooking,
  createBlocking,
} from '../api/admin/bookings';
import { useToast } from './useToast';
import { plural } from '../utils/format';

/**
 * Écritures de l'écran A-03 : création, blocage et annulation.
 *
 * Regroupées ici pour que la page ne porte que l'agencement. Chaque action
 * rend la main via `onDone` pour recharger la liste, et signale son issue par
 * une notification — jamais silencieusement.
 */
export function useBookingActions({ onDone }) {
  const toast = useToast();
  const [envoi, setEnvoi] = useState(false);

  const executer = async (action) => {
    setEnvoi(true);
    try {
      await action();
      await onDone();
      return true;
    } finally {
      setEnvoi(false);
    }
  };

  const creer = ({ mode, payload }) =>
    executer(async () => {
      try {
        const cree =
          mode === 'blocage' ? await createBlocking(payload) : await createAdminBooking(payload);
        toast.success(
          mode === 'blocage' ? 'Salle bloquée' : 'Réservation créée',
          `${cree.room?.name ?? ''} — ${cree.title}`,
        );
      } catch (erreur) {
        toast.error('Création impossible', erreur.message);
        throw erreur;
      }
    }).catch(() => false);

  const annuler = (ids, { reason, notifyOwner }) =>
    executer(async () => {
      try {
        if (ids.length === 1) {
          await cancelAdminBooking(ids[0], { reason, notifyOwner });
          toast.success('Réservation annulée', reason);
          return;
        }
        const bilan = await cancelBookings(ids, { reason, notifyOwner });
        toast.success(
          plural(bilan.annulees.length, 'réservation annulée', 'réservations annulées'),
          // Le compte rendu dit ce qui a réellement été traité : une annulation
          // groupée silencieuse laisserait croire que tout est passé.
          bilan.ignorees.length > 0
            ? `${plural(bilan.ignorees.length, 'ligne ignorée', 'lignes ignorées')} : ${bilan.ignorees[0].motif}.`
            : reason,
        );
      } catch (erreur) {
        toast.error('Annulation impossible', erreur.message);
        throw erreur;
      }
    }).catch(() => false);

  return { envoi, creer, annuler };
}
