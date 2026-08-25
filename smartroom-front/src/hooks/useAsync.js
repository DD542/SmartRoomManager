import { useCallback, useEffect, useRef, useState } from 'react';
import { isCancelled } from '../api/client';

/**
 * Exécute une fonction de src/api/ et expose les quatre états attendus par
 * chaque écran : 'chargement' | 'succes' | 'erreur', l'état « vide » étant
 * déduit par la page à partir de `data`.
 *
 * @param {Function} fn        fonction asynchrone, typiquement une fonction d'API
 * @param {Array} deps         dépendances de rechargement
 * @param {{immediate?:boolean, initialData?:any}} options
 */
export function useAsync(fn, deps = [], options = {}) {
  const { immediate = true, initialData = null } = options;
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState(immediate ? 'chargement' : 'inactif');
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const callbackRef = useRef(fn);
  callbackRef.current = fn;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    setStatus('chargement');
    setError(null);
    try {
      const result = await callbackRef.current(...args);
      if (!mounted.current) return null;
      setData(result);
      setStatus('succes');
      return result;
    } catch (err) {
      if (!mounted.current) return null;
      // Une annulation n'est pas un échec : c'est le résultat attendu quand un
      // filtre change avant que la réponse précédente n'arrive. La signaler
      // comme une erreur inverserait l'intention du mécanisme d'annulation, et
      // afficherait « Impossible de charger » pendant qu'une requête plus
      // récente est en vol. L'état reste « chargement » : c'est elle qui
      // conclura.
      if (isCancelled(err)) return null;
      setError(err);
      setStatus('erreur');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    setData,
    error,
    status,
    isLoading: status === 'chargement',
    isError: status === 'erreur',
    isSuccess: status === 'succes',
    reload: run,
  };
}
