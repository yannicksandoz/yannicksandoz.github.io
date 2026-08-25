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
  'freesound-panel', 'data-fs-', 'freesound.org/apiv2',
  'sauvegarde-panel', 'data-sv-',
  // la photo path-tracée est un outil d'AUTEUR : ni la bibliothèque ni son
  // bouton n'ont leur place dans le build visiteur
  'WebGLPathTracer', 'photo-progres',
  // les icônes Lucide n'habillent que l'éditeur ; « lucide.dev » est la
  // chaîne du crédit, qui survit à la minification — le mot français
  // « lucide » seul serait un faux positif possible dans du contenu
  'lucide.dev'
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
  'api.poly.pizza', 'freesound.org/apiv2', 'unpkg.com', 'cdn.jsdelivr', 'googleapis.com',
  // AUCUNE POLICE PAR LE RÉSEAU. La leçon vient de troika, qui allait
  // chercher Roboto ici quand on ne lui donnait pas de fichier ; le
  // lettrage Slug embarque ses courbes et n'a plus de police au sens
  // fichier, mais la ligne reste : si un futur composant réintroduisait un
  // chargement de police distant, le build ne partirait pas.
  'fonts.gstatic.com',
  // La mise en ligne écrit un commit sur le dépôt de l'auteur : c'est le
  // geste le plus puissant de l'éditeur, et il n'a rien à faire dans les
  // mains d'un visiteur.
  'api.github.com'
];

/**
 * Il n'y a AUCUNE adresse tolérée. Il y en a eu une : le résolveur de
 * polices de repli embarqué par troika portait un CDN en constante
 * compilée, et l'on avait dû prouver qu'il ne serait jamais appelé plutôt
 * que de pouvoir le retirer. Le lettrage Slug a remplacé troika — les
 * courbes d'Inter sont dans le bundle, plus aucune police ne vient du
 * réseau — et la règle est redevenue simple : un hôte interdit qui
 * apparaît, c'est un build qui ne part pas.
 */
const TOLERES = [];

/** Motifs de clé d'API : aucune ne doit jamais être commitée ni publiée. */
const MOTIFS_CLE = [
  /\bAIza[0-9A-Za-z_-]{35}\b/,              // Google
  /\bsk-[A-Za-z0-9]{32,}\b/,                 // style OpenAI
  /\bghp_[A-Za-z0-9]{36}\b/,                 // jeton GitHub (classique)
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,        // jeton GitHub (fine-grained)
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

// Les en-têtes de copyright d'Airwindows vivent DANS les sources de worklet,
// chargées en `?raw` : ce sont des chaînes de caractères et non des
// commentaires, et c'est pour cela qu'elles traversent la minification. Cela
// tient à un détail de montage — donc on le vérifie.
let creditAirwindows = false;
// Même exigence pour Slug : Eric Lengyel demande le crédit en échange de
// ses shaders. Le nom vit dans les CHAÎNES GLSL du lettrage (un shader est
// une chaîne, pas un commentaire) et doit donc survivre à la minification.
let creditLengyel = false;

for (const chemin of texte) {
  const contenu = await readFile(chemin, 'utf8');
  if (extname(chemin) === '.js' && contenu.includes('airwindows')) {
    creditAirwindows = true;
  }
  if (extname(chemin) === '.js' && contenu.includes('Lengyel')) {
    creditLengyel = true;
  }

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
    // On ôte d'abord les adresses TOLÉRÉES, puis on cherche l'hôte : sans
    // cela, une seule adresse tolérée dédouanerait tout le fichier.
    let reste = contenu;
    for (const t of TOLERES) reste = reste.split(t).join('');
    if (reste.includes(hote)) erreurs.push(`${chemin} : hôte tiers « ${hote} »`);
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

// LA LICENCE D'AIRWINDOWS DOIT PARTIR AVEC LE BUILD.
//
// « The above copyright notice AND THIS PERMISSION NOTICE shall be included
// in all copies or substantial portions of the Software » — ce sont les mots
// du texte MIT, et ils demandent deux choses, pas une. Citer le nom de Chris
// ne suffit pas : il faut que le texte de la licence voyage avec le code.
// Neuf plugins d'Airwindows sont portés ici ; c'est une part substantielle,
// et un portage est une œuvre dérivée.
//
// On le vérifie sur le BUILD et non sur le dépôt, comme tout le reste de ce
// fichier : un fichier de licence oublié dans une recopie ne se voit jamais,
// et c'est exactement le genre de manquement qui ne se découvre que quand
// quelqu'un s'en plaint.
const licence = tous.find((f) => f.endsWith('LICENCES/airwindows-MIT.txt'));
if (!licence) {
  erreurs.push('la licence d’Airwindows ne part pas avec le build '
    + `(attendu ${RACINE}/LICENCES/airwindows-MIT.txt)`);
} else {
  const corps = await readFile(licence, 'utf8');
  for (const attendu of ['Permission is hereby granted',
    'this permission notice shall be included', 'Chris Johnson']) {
    if (!corps.includes(attendu)) {
      erreurs.push(`la licence d’Airwindows est incomplète : « ${attendu} » manque`);
    }
  }
}

// …et les lignes de copyright, elles, doivent survivre à la minification.
if (!creditAirwindows) {
  erreurs.push('aucune mention d’Airwindows dans le JS livré : les en-têtes '
    + 'de copyright ont été perdus à la minification');
}
if (!creditLengyel) {
  erreurs.push('aucune mention d’Eric Lengyel dans le JS livré : le crédit '
    + 'exigé par la licence de Slug a été perdu');
}

// …et la licence de Slug part avec le build, comme celle d'Airwindows.
const licenceSlug = tous.find((f) => f.endsWith('LICENCES/slug-MIT.txt'));
if (!licenceSlug) {
  erreurs.push('la licence de Slug ne part pas avec le build '
    + `(attendu ${RACINE}/LICENCES/slug-MIT.txt)`);
} else {
  const corpsSlug = await readFile(licenceSlug, 'utf8');
  for (const attendu of ['Permission is hereby granted', 'Eric Lengyel']) {
    if (!corpsSlug.includes(attendu)) {
      erreurs.push(`la licence de Slug est incomplète : « ${attendu} » manque`);
    }
  }
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
