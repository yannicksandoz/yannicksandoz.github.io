import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Le dossier de contenu est recopié TEL QUEL à la racine du site : ce qu'on
 * y range est publié. Or l'éditeur y archive l'état d'avant chaque
 * publication (`content/.sauvegardes/`) — des copies entières de la galerie,
 * qui partiraient en ligne à l'insu de tout le monde, et qu'un curieux
 * pourrait parcourir. On les retire de `dist/`, dans les deux builds ;
 * `scripts/check-visitor-build.mjs` vérifie ensuite qu'il n'en reste rien
 * plutôt que de le supposer.
 */
const SAUVEGARDES = '.sauvegardes';

function retirerSauvegardes() {
  let sortie = 'dist';
  return {
    name: 'galerie-retirer-sauvegardes',
    // le dossier de sortie vient de --outDir : on le demande à Vite plutôt
    // que de le deviner, pour que le build Auteur soit couvert lui aussi
    configResolved(config) { sortie = config.build.outDir; },
    closeBundle() {
      rmSync(join(sortie, SAUVEGARDES), { recursive: true, force: true });
    }
  };
}

/**
 * Un fichier de configuration au lieu de cent soixante-quinze.
 *
 * Le contenu vit en un fichier par œuvre et par pièce : c'est ce qui rend
 * une galerie lisible, versionnable, modifiable à la main. Mais le
 * navigateur, lui, paie chaque fichier — l'index, puis les œuvres par
 * vagues de huit, soit une vingtaine d'allers-retours EN SÉRIE avant que la
 * scène puisse se construire. Sur un réseau mobile à 100 ms de latence,
 * c'est plusieurs secondes d'écran de chargement, à chaque visite.
 *
 * Le chargeur sait déjà lire un fichier combiné, et le préfère : c'est le
 * format que produit l'export de l'éditeur. Il n'était simplement jamais
 * écrit. Ce plugin le fabrique À LA PUBLICATION, dans `dist/` seulement —
 * `content/` garde ses fichiers séparés, qui restent la source de vérité et
 * le repli si le combiné manque.
 *
 * L'ordre suit l'index : c'est lui qui décide de l'ordre des pièces dans le
 * menu et du parcours du catalogue.
 */
function combinerContenu() {
  let sortie = 'dist';
  return {
    name: 'galerie-combiner-contenu',
    configResolved(config) { sortie = config.build.outDir; },
    closeBundle() {
      for (const genre of ['works', 'rooms']) {
        const dossier = join(sortie, genre);
        const index = lireJson(join(dossier, 'index.json'));
        const noms = Array.isArray(index) ? index : index?.[genre];
        if (!Array.isArray(noms) || !noms.length) continue;
        const items = [];
        let complet = true;
        for (const nom of noms) {
          const fichier = String(nom).endsWith('.json') ? String(nom) : `${nom}.json`;
          const item = lireJson(join(dossier, fichier));
          // un fichier illisible et l'on renonce : mieux vaut le chargement
          // par fichier, qui sait ignorer l'intrus avec un avertissement,
          // qu'un combiné amputé en silence
          if (!item) { complet = false; break; }
          items.push(item);
        }
        if (complet) {
          writeFileSync(join(dossier, `${genre}.json`), JSON.stringify(items));
        }
      }
    }
  };
}

function lireJson(chemin) {
  try { return JSON.parse(readFileSync(chemin, 'utf8')); } catch { return null; }
}

/**
 * Proxy local pour l'éditeur (mode Auteur uniquement).
 *
 * L'API Poly Pizza refuse le préflight CORS qu'impose l'en-tête
 * X-Auth-Token : depuis un navigateur, l'appel direct échoue en
 * « injoignable » alors que le réseau va bien. En local, l'éditeur passe
 * par ces chemins same-origin (voir editor/polypizza/api.js, qui retombe
 * sur l'appel direct si le proxy est absent).
 *
 * Aucun effet sur ce qui est publié : ce proxy n'existe qu'à l'exécution
 * de `vite`/`vite preview`, rien n'en est émis dans dist/, et le build
 * Visiteur n'appelle jamais l'API (scripts/check-visitor-build.mjs y veille).
 */
const proxyPolyPizza = {
  '/pp-api': {
    target: 'https://api.poly.pizza',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/pp-api/, '')
  },
  '/pp-static': {
    target: 'https://static.poly.pizza',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/pp-static/, '')
  },
  // Freesound : même raison (en-tête Authorization → préflight CORS)
  '/fs-api': {
    target: 'https://freesound.org',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/fs-api/, '')
  }
};

export default defineConfig({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine
  // comme dans un sous-dossier (ex. https://exemple.org/galerie/).
  base: './',

  server: { proxy: proxyPolyPizza },
  preview: { proxy: proxyPolyPizza },

  // Séparation moteur / contenu : le dossier de contenu (œuvres + médias)
  // est servi tel quel à la racine du site. Pour brancher VOTRE contenu
  // sans toucher au moteur :
  //   GALERIE_CONTENT=../mon-contenu npm run build
  publicDir: process.env.GALERIE_CONTENT || 'content',

  plugins: [retirerDomEditeur(), retirerSauvegardes(), combinerContenu()],

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
