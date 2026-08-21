import { useEffect, useState } from 'react';
import { checkAdminSlot } from '../api/admin/bookings';

/**
 * Vérifie un créneau pendant la saisie, avec le moteur de conflits du tunnel
 * utilisateur.
 *
 * Chaque frappe relance la vérification : le drapeau `vivant` empêche une
 * réponse tardive d'écraser le verdict d'une saisie plus récente.
 */
export function useSlotCheck({ roomId, start, end, attendees = 1, actif = true }) {
  const [verdict, setVerdict] = useState(null);
  const [verification, setVerification] = useState(false);

  useEffect(() => {
    if (!actif || !roomId || !start || !end) {
      setVerdict(null);
      return undefined;
    }
    let vivant = true;
    setVerification(true);
    checkAdminSlot({ roomId, start, end, attendees })
      .then((resultat) => vivant && setVerdict(resultat))
      .catch(() => vivant && setVerdict(null))
      .finally(() => vivant && setVerification(false));

    return () => {
      vivant = false;
    };
  }, [actif, roomId, start, end, attendees]);

  return { verdict, verification };
}
