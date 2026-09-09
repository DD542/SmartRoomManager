import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { appliquerTheme, themeInitial } from './hooks/useTheme';

// Avant le premier rendu, et non depuis un effet : appliqué après, le thème
// sombre s'afficherait un instant avant de céder au clair, et ce clignotement
// se voit à chaque chargement de page.
appliquerTheme(themeInitial());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
