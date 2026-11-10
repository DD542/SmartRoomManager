import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { appliquerTheme, themeInitial } from './hooks/useTheme';

// Avant le premier rendu, et non depuis un effet : appliqué après, le thème
// sombre s'afficherait un instant avant de céder au clair, et ce clignotement
// se voit à chaque chargement de page.
appliquerTheme(themeInitial());

/**
 * Un onglet resté ouvert pendant un déploiement garde l'ancienne version : le
 * jour où il charge un module à la demande (le générateur de PDF, par exemple),
 * il réclame un fichier que le nouveau déploiement a remplacé, et l'écran
 * casse. Vite signale ce cas par `vite:preloadError` : on recharge la page,
 * qui récupère la version en ligne.
 *
 * Une fois par minute au plus : si le fichier manque vraiment, recharger en
 * boucle n'arrangerait rien.
 */
window.addEventListener('vite:preloadError', (event) => {
  const CLE = 'smartroom:rechargement-version';
  let dernier = 0;
  try {
    dernier = Number(sessionStorage.getItem(CLE) || 0);
  } catch {
    // Stockage indisponible (navigation privée stricte) : on recharge quand même.
  }
  if (Date.now() - dernier < 60_000) return;
  try {
    sessionStorage.setItem(CLE, String(Date.now()));
  } catch {
    // idem
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
