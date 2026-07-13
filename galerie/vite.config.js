import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine
  // comme dans un sous-dossier (ex. https://exemple.org/galerie/).
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  }
});
