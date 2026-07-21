import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine
  // comme dans un sous-dossier (ex. https://exemple.org/galerie/).
  base: './',

  // Séparation moteur / contenu : le dossier de contenu (œuvres + médias)
  // est servi tel quel à la racine du site. Pour brancher VOTRE contenu
  // sans toucher au moteur :
  //   GALERIE_CONTENT=../mon-contenu npm run build
  publicDir: process.env.GALERIE_CONTENT || 'content',

  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  }
});
