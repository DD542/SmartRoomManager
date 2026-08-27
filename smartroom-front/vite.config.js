import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Adresse du back, réglable sans toucher au fichier.
 *
 * Le port 8000 reste la valeur par défaut, celle de `docker-compose` et de la
 * chaîne d'intégration. `VITE_API_TARGET` permet de la déplacer quand le port
 * est déjà pris sur la machine — un service oublié, un relais qui survit à son
 * processus — sans imposer ce détournement à tout le monde.
 */
const API = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    // Le back FastAPI : seul src/api/ changera de transport.
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
      },
      // Les fichiers déposés — photos de salle, plans d'étage, photos de
      // profil — sont servis par l'API sous `/media`. Sans cette entrée, le
      // serveur de développement répond son index HTML à la place de l'image,
      // et toutes les illustrations de l'application restent cassées en local
      // sans qu'aucune erreur ne le dise : le navigateur affiche simplement le
      // texte alternatif.
      '/media': {
        target: API,
        changeOrigin: true,
      },
    },
  },
});
