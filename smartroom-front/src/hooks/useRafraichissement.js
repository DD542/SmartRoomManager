import { useEffect, useRef } from 'react';

/**
 * Relit les données d'un écran sans qu'on le demande.
 *
 * Les listes n'étaient lues qu'à l'ouverture : un administrateur qui gardait
 * « Toutes les réservations » ouvert ne voyait pas la réservation qu'un
 * utilisateur venait de faire, tant qu'il ne rechargeait pas la page.
 *
 * Deux déclencheurs :
 *  - le retour sur l'onglet — c'est là qu'on s'attend à voir du neuf ;
 *  - un intervalle, trente secondes par défaut, **seulement onglet visible** :
 *    un onglet en arrière-plan n'interroge pas l'API pour rien, et ne la
 *    tient pas éveillée sur l'hébergement de démonstration.
 *
 * `relire` doit être une relecture discrète (`useAsync().refresh`) : sinon
 * chaque passage ferait clignoter l'écran.
 *
 * @param {() => unknown} relire
 * @param {{ intervalle?: number, actif?: boolean }} options
 */
export function useRafraichissement(relire, { intervalle = 30_000, actif = true } = {}) {
  const relireRef = useRef(relire);
  relireRef.current = relire;

  useEffect(() => {
    if (!actif) return undefined;
    const visible = () => document.visibilityState === 'visible';
    const relireSiVisible = () => {
      if (visible()) relireRef.current?.();
    };

    const minuterie = setInterval(relireSiVisible, intervalle);
    document.addEventListener('visibilitychange', relireSiVisible);
    window.addEventListener('focus', relireSiVisible);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', relireSiVisible);
      window.removeEventListener('focus', relireSiVisible);
    };
  }, [intervalle, actif]);
}
