import { useCallback, useEffect, useState } from 'react';

/**
 * Thème clair ou sombre, partagé par les trois espaces.
 *
 * Le thème est porté par un attribut sur `<html>` — `data-theme="clair"`, ou
 * son absence pour le sombre — et non par une classe sur un conteneur React :
 * `body`, la barre de défilement et les sélecteurs de date natifs sont hors de
 * l'arbre React, et ne verraient pas une classe posée dedans.
 *
 * La valeur retenue est écrite dans `localStorage`. Sans elle, on suit la
 * préférence du système : quelqu'un qui a réglé son poste en clair n'a pas à
 * refaire ce choix ici, et le produit reste sombre par défaut pour les autres.
 */

export const CLE = 'smartroom:theme';

const SOMBRE = 'sombre';
const CLAIR = 'clair';

/** Le thème actuellement appliqué au document. */
export function themeCourant() {
  return document.documentElement.dataset.theme === CLAIR ? CLAIR : SOMBRE;
}

/**
 * Applique un thème au document.
 *
 * Exporté pour que `main.jsx` puisse le poser avant le premier rendu : appliqué
 * depuis un effet, le sombre s'afficherait un instant avant de céder au clair,
 * et ce clignotement se voit à chaque chargement.
 */
export function appliquerTheme(theme) {
  const racine = document.documentElement;
  if (theme === CLAIR) racine.dataset.theme = CLAIR;
  else delete racine.dataset.theme;

  // La barre d'adresse des navigateurs mobiles suit cette balise. Laissée sur
  // la teinte sombre, elle trancherait au-dessus d'une page devenue claire.
  const balise = document.querySelector('meta[name="theme-color"]');
  if (balise) balise.setAttribute('content', theme === CLAIR ? '#F4F7FB' : '#0F1117');
}

/** Le thème à appliquer au démarrage : le choix mémorisé, sinon le système. */
export function themeInitial() {
  let memorise = null;
  try {
    memorise = localStorage.getItem(CLE);
  } catch {
    // Navigation privée, stockage refusé : on retombe sur la préférence
    // système plutôt que d'échouer au chargement.
  }
  if (memorise === CLAIR || memorise === SOMBRE) return memorise;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? CLAIR : SOMBRE;
}

export function useTheme() {
  const [theme, setTheme] = useState(themeCourant);

  // Le thème peut changer depuis un autre onglet, ou depuis un autre espace de
  // l'application monté sur le même document.
  useEffect(() => {
    const surStockage = (evenement) => {
      if (evenement.key !== CLE) return;
      const suivant = evenement.newValue === CLAIR ? CLAIR : SOMBRE;
      appliquerTheme(suivant);
      setTheme(suivant);
    };
    window.addEventListener('storage', surStockage);
    return () => window.removeEventListener('storage', surStockage);
  }, []);

  const basculer = useCallback(() => {
    const suivant = themeCourant() === CLAIR ? SOMBRE : CLAIR;
    appliquerTheme(suivant);
    setTheme(suivant);
    try {
      localStorage.setItem(CLE, suivant);
    } catch {
      // Le thème s'applique quand même ; il ne survivra pas au rechargement.
    }
  }, []);

  return { theme, clair: theme === CLAIR, basculer };
}
