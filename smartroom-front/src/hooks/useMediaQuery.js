import { useEffect, useState } from 'react';

/** Écoute une media query. Sert à basculer les filtres en bottom-sheet sous 768px. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = (event) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/** Bascule métier du projet : tout ce qui est sous 768px passe en mode compact. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
