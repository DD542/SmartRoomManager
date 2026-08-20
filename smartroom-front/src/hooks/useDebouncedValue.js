import { useEffect, useState } from 'react';

/**
 * Retarde la propagation d'une valeur : la frappe reste instantanée à l'écran
 * tandis que la requête n'est lancée qu'une fois la saisie stabilisée.
 */
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
