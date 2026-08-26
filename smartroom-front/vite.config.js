import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
    // Le back FastAPI tournera sur 8000 : seul src/api/ changera de transport.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Les fichiers déposés — photos de salle, plans d'étage, photos de
      // profil — sont servis par l'API sous `/media`. Sans cette entrée, le
      // serveur de développement répond son index HTML à la place de l'image,
      // et toutes les illustrations de l'application restent cassées en local
      // sans qu'aucune erreur ne le dise : le navigateur affiche simplement le
      // texte alternatif.
      '/media': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
