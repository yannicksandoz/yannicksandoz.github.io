/**
 * Garde-fou : rien de l'éditeur ne doit se trouver dans un build Visiteur.
 *
 * Lancé après `npm run build`, en local comme en CI. Il inspecte le RÉSULTAT
 * plutôt que la configuration : c'est la seule vérification qui tienne, parce
 * qu'une erreur de config est précisément ce qu'on cherche à attraper.
 *
 * Il échoue aussi sur toute URL externe trouvée dans le JS livré : une galerie
 * publiée doit fonctionner indéfiniment même si tous les services tiers sont
 * hors ligne, et ne rien émettre vers eux.
 *
 *   node scripts/check-visitor-build.mjs [dossier]   (défaut : dist)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const RACINE = process.argv[2] ?? 'dist';

/** Empreintes du mode Auteur. Chacune suffit à faire échouer la publication. */
const EMPREINTES_EDITEUR = [
  'editor-hierarchy', 'editor-bar', 'editor-panel', 'edit-toggle',
  'voxel-panel', 'library-panel', 'lib-tile', 'vx-swatch',
  'mountEditor', 'TransformControls', 'GLTFExporter',
  'editor-file-media', 'editor-file-json',
  'data-vx-', 'data-lib-add', 'data-a-prim',
  'polypizza-panel', 'data-pp-', 'X-Auth-Token',
  'sons-panel', 'data-son-',
  'freesound-panel', 'data-fs-', 'freesound.org/apiv2'
];

/**
 * Hôtes tiers **appelés**. La distinction qui compte n'est pas « ce nom
 * apparaît » mais « le navigateur contacte ce serveur ».
 *
 * Deux hôtes sont donc absents de cette liste, et c'est délibéré :
 *   • `ko-fi.com`  — le chapeau ouvre une page de paiement AU CLIC ;
 *   • `poly.pizza` — la mention d'attribution est un LIEN, et elle est
 *     obligatoire : l'interdire ici reviendrait à interdire de respecter
 *     les conditions d'usage.
 *
 * Ce qui est interdit, c'est l'**API** : `api.poly.pizza` n'a rien à faire
 * dans un build Visiteur, puisqu'une scène exportée référence des fichiers
 * locaux et jamais une URL Poly Pizza. Même règle pour `freesound.org/apiv2`
 * — la page d'un son reste citable en lien dans les crédits, son API non.
 */
const HOTES_INTERDITS = [
  'api.poly.pizza', 'freesound.org/apiv2', 'unpkg.com', 'cdn.jsdelivr', 'googleapis.com'
];

/** Motifs de clé d'API : aucune ne doit jamais être commitée ni publiée. */
const MOTIFS_CLE = [
  /\bAIza[0-9A-Za-z_-]{35}\b/,              // Google
  /\bsk-[A-Za-z0-9]{32,}\b/,                 // style OpenAI
  /\bghp_[A-Za-z0-9]{36}\b/,                 // jeton GitHub
  /["']?(api[_-]?key|apikey)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i
];

const EXTENSIONS_TEXTE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.svg', '.txt']);

async function fichiers(dossier) {
  const trouves = [];
  for (const entree of await readdir(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) trouves.push(...await fichiers(chemin));
    else trouves.push(chemin);
  }
  return trouves;
}

const erreurs = [];

try {
  await stat(RACINE);
} catch {
  console.error(`✗ ${RACINE}/ introuvable — lancez d'abord « npm run build ».`);
  process.exit(1);
}

const tous = await fichiers(RACINE);
const texte = tous.filter((f) => EXTENSIONS_TEXTE.has(extname(f)));

for (const chemin of texte) {
  const contenu = await readFile(chemin, 'utf8');

  // Le catalogue de la bibliothèque est du CONTENU, pas de l'éditeur : il
  // décrit du mobilier que le visiteur affiche. On ne l'inspecte que pour
  // les clés et les hôtes.
  const contenuSeul = chemin.includes(`${RACINE}/library/`);

  if (!contenuSeul) {
    for (const empreinte of EMPREINTES_EDITEUR) {
      if (contenu.includes(empreinte)) {
        erreurs.push(`${chemin} : empreinte d'éditeur « ${empreinte} »`);
      }
    }
  }
  for (const hote of HOTES_INTERDITS) {
    if (contenu.includes(hote)) erreurs.push(`${chemin} : hôte tiers « ${hote} »`);
  }
  for (const motif of MOTIFS_CLE) {
    if (motif.test(contenu)) erreurs.push(`${chemin} : ressemble à une clé d'API`);
  }
}

// Les SAUVEGARDES d'avant-publication vivent dans le dossier de contenu,
// que Vite recopie tel quel à la racine du site : sans le plugin qui les
// retire, chaque version antérieure de la galerie partirait en ligne, et
// se laisserait parcourir par qui connaît le chemin. On le vérifie ici
// plutôt que de faire confiance au plugin.
const sauvegardes = tous.filter((f) => f.includes('/.sauvegardes/'));
if (sauvegardes.length) {
  erreurs.push(`sauvegardes d'éditeur publiées : ${sauvegardes.length} fichier(s), `
    + `dont ${sauvegardes[0]}`);
}

// Un modèle Poly Pizza n'a rien à faire dans le dépôt du moteur : les
// modèles importés vivent dans les projets de galerie.
const modelesHorsLibrairie = tous.filter(
  (f) => /\.(glb|gltf)$/i.test(f) && !f.includes(`${RACINE}/library/`)
);
if (modelesHorsLibrairie.length) {
  erreurs.push(`modèles 3D hors library/ : ${modelesHorsLibrairie.join(', ')}`);
}

console.log(`${texte.length} fichiers texte inspectés dans ${RACINE}/`);

if (erreurs.length) {
  console.error('\n✗ Ce build ne doit pas être publié :\n');
  for (const e of erreurs) console.error(`   ${e}`);
  console.error('\nUn build Visiteur se produit sans GALERIE_EDITOR ; avec, on');
  console.error('obtient un build Auteur, qui reste sur votre machine.\n');
  process.exit(1);
}

console.log('✓ aucun code d\'éditeur, aucun hôte tiers, aucune clé — publiable.');
