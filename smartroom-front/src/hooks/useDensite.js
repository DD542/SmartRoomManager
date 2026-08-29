import { useEffect, useState } from 'react';

/**
 * Densité d'affichage des tableaux d'administration.
 *
 * Deux valeurs : `confortable`, qui aère les lignes et montre les colonnes de
 * troisième rang, et `compact`, qui les resserre pour tenir davantage de
 * lignes à l'écran. Un réglage d'espace de travail, pas une préférence
 * esthétique : celui qui arbitre cent conflits par jour ne lit pas la même
 * table que celui qui vérifie une salle par semaine.
 *
 * La densité ne change jamais les seuils de bascule : sous 768 px on est en
 * cartes quelle qu'elle soit. Resserrer une table déjà trop large ne la rend
 * pas lisible, cela repousse seulement le moment où l'on s'en aperçoit.
 *
 * Le réglage vit dans un module et non dans un contexte : il est lu par des
 * composants dispersés — chaque table, la barre haute — et un contexte de plus
 * autour de l'application ne porterait qu'une chaîne de caractères.
 */

const CLE = 'smartroom.admin.densite';
const VALEURS = ['confortable', 'compact'];

const lire = () => {
  try {
    const valeur = window.localStorage.getItem(CLE);
    return VALEURS.includes(valeur) ? valeur : 'confortable';
  } catch {
    // Navigation privée, stockage refusé : la densité par défaut convient.
    return 'confortable';
  }
};

let courante = typeof window === 'undefined' ? 'confortable' : lire();
const abonnes = new Set();

export function definirDensite(valeur) {
  if (!VALEURS.includes(valeur) || valeur === courante) return;
  courante = valeur;
  try {
    window.localStorage.setItem(CLE, valeur);
  } catch {
    /* sans effet : le réglage vaut pour la session en cours */
  }
  abonnes.forEach((abonne) => abonne(valeur));
}

export function useDensite() {
  const [densite, setDensite] = useState(courante);

  useEffect(() => {
    setDensite(courante);
    abonnes.add(setDensite);
    return () => {
      abonnes.delete(setDensite);
    };
  }, []);

  return { densite, definirDensite, compact: densite === 'compact' };
}
