import { useEffect, useState } from 'react';

/**
 * Y a-t-il une surface bloquante ouverte — modale, feuille, tiroir ?
 *
 * Les panneaux flottants doivent s'effacer devant une décision demandée à
 * l'utilisateur : l'assistant qui reste déployé par-dessus une modale vole des
 * pixels à ce qu'on lui demande de lire, et capte des clics qui ne lui étaient
 * pas destinés.
 *
 * Le compte est tenu par `useFocusTrap`, et non par chaque composant : toute
 * surface bloquante de l'application passe déjà par lui pour piéger le focus.
 * Une surface qui l'oublierait n'aurait de toute façon ni Échap, ni retour du
 * focus — le défaut se verrait ailleurs avant de se voir ici.
 */

let ouvertes = 0;
const abonnes = new Set();

const notifier = () => abonnes.forEach((abonne) => abonne(ouvertes));

/** Signale une surface ouverte. Rend la fonction qui la referme. */
export function declarerSurfaceBloquante() {
  ouvertes += 1;
  notifier();

  let relachee = false;
  return () => {
    // Idempotent : un double appel de nettoyage — React en mode strict monte
    // et démonte deux fois — laisserait sinon le compte négatif, et l'assistant
    // ne se replierait plus jamais.
    if (relachee) return;
    relachee = true;
    ouvertes = Math.max(0, ouvertes - 1);
    notifier();
  };
}

export function useSurfaceBloquante() {
  const [compte, setCompte] = useState(ouvertes);

  useEffect(() => {
    // Relecture au montage : une surface peut s'être ouverte entre le premier
    // rendu et l'effet.
    setCompte(ouvertes);
    abonnes.add(setCompte);
    return () => {
      abonnes.delete(setCompte);
    };
  }, []);

  return compte > 0;
}
