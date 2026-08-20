import { useCallback, useEffect, useState } from 'react';
import { getAvailabilityRange } from '../api/availability';
import { checkSlot } from '../api/bookings';
import { mergeDateAndTime } from '../utils/dates';

/**
 * Disponibilité d'une salle sur la plage actuellement affichée par le
 * calendrier (jour, semaine, mois ou année), plus la vérification en direct du
 * créneau sélectionné : règles d'ouverture, conflits, alternatives.
 */
export function useAvailability(roomId, range, slot) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('chargement');
  const [error, setError] = useState(null);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);

  const from = range?.start ? new Date(range.start).toISOString() : null;
  const to = range?.end ? new Date(range.end).toISOString() : null;

  const load = useCallback(async () => {
    if (!roomId || !from || !to) return;
    setStatus('chargement');
    try {
      setData(await getAvailabilityRange(roomId, from, to));
      setStatus('succes');
    } catch (err) {
      setError(err);
      setStatus('erreur');
    }
  }, [roomId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!roomId || !slot?.date || !slot?.startTime || !slot?.endTime) {
      setCheck(null);
      return undefined;
    }
    setChecking(true);
    checkSlot({
      roomId,
      start: mergeDateAndTime(slot.date, slot.startTime),
      end: mergeDateAndTime(slot.date, slot.endTime),
      ignoreBookingId: slot.ignoreBookingId,
    })
      .then((result) => {
        if (!cancelled) setCheck(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, slot?.date, slot?.startTime, slot?.endTime, slot?.ignoreBookingId]);

  return {
    bookings: data?.bookings ?? [],
    rules: data?.rules ?? null,
    status,
    error,
    isLoading: status === 'chargement',
    isError: status === 'erreur',
    reload: load,
    check,
    checking,
    conflicts: check?.conflicts ?? [],
    alternatives: check?.alternatives ?? [],
    ruleErrors: check?.rules?.errors ?? [],
    ruleWarnings: check?.rules?.warnings ?? [],
    canBook: Boolean(check?.ok),
  };
}
