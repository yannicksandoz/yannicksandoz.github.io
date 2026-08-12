import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Deux builds, une seule base de code.
 *
 *   GALERIE_EDITOR=1  →  mode AUTEUR   : éditeur inclus, pour la machine locale
 *   (absent)          →  mode VISITEUR : éditeur absent du résultat, pour Pages
 *
 * Le mode Visiteur ne se contente pas de désactiver l'éditeur : il le rend
 * **inatteignable pour Rollup**, donc jamais émis. Un chunk d'éditeur publié
 * reste téléchargeable par simple URL, quelle que soit la visibilité du
 * dépôt — c'est le trou que ce réglage ferme.
 *
 * Trois choses disparaissent ensemble, et il faut les trois :
 *   1. le JS   — `editorLoader.js` est remplacé par un module vide, ce qui
 *                coupe la seule racine menant à `editor/index.js` ;
 *   2. le CSS  — `editor.css` est importé par l'éditeur, donc il suit ;
 *   3. le DOM  — le bloc `<!-- editor:start … end -->` est retiré du HTML.
 *
 * `scripts/check-visitor-build.mjs` vérifie le résultat plutôt que de le
 * supposer, et le workflow de déploiement échoue s'il trouve quoi que ce soit.
 */
const modeAuteur = process.env.GALERIE_EDITOR === '1';

/**
 * L'éditeur peut vivre dans un sous-module privé. S'il n'est pas récupéré,
 * un build Auteur échoue sur « Could not resolve ./editor/index.js », ce qui
 * n'aide personne. On dit plutôt quoi taper.
 *
 * Le mode Visiteur, lui, n'a rien à vérifier : il n'importe pas l'éditeur,
 * et c'est justement ce qui permet à la CI de construire sans y avoir accès.
 */
if (modeAuteur) {
  const dossier = fileURLToPath(new URL('./engine/src/editor', import.meta.url));
  if (!existsSync(join(dossier, 'index.js'))) {
    throw new Error(
      "Mode Auteur demandé, mais engine/src/editor/ est vide.\n"
      + "Si l'éditeur est un sous-module privé :\n"
      + '    git submodule update --init --recursive\n'
      + "Sinon, construisez en mode Visiteur avec « npm run build »."
    );
  }
}

/** Retire du HTML le bloc balisé pour l'éditeur. */
function retirerDomEditeur() {
  return {
    name: 'galerie-retirer-dom-editeur',
    transformIndexHtml(html) {
      if (modeAuteur) return html;
      return html.replace(
        /[ \t]*<!--\s*editor:start[\s\S]*?editor:end\s*-->\n?/g, ''
      );
    }
  };
}

export default defineConfig({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine
  // comme dans un sous-dossier (ex. https://exemple.org/galerie/).
  base: './',

  // Séparation moteur / contenu : le dossier de contenu (œuvres + médias)
  // est servi tel quel à la racine du site. Pour brancher VOTRE contenu
  // sans toucher au moteur :
  //   GALERIE_CONTENT=../mon-contenu npm run build
  publicDir: process.env.GALERIE_CONTENT || 'content',

  plugins: [retirerDomEditeur()],

  resolve: {
    // Un alias plutôt qu'un `if` dans le code : une condition à l'exécution
    // laisserait l'import dynamique visible de Rollup, donc le chunk émis.
    alias: modeAuteur ? [] : [{
      find: /^.*\/editorLoader\.js$/,
      replacement: fileURLToPath(new URL('./engine/src/editorLoader.stub.js', import.meta.url))
    }]
  },

  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  }
});
