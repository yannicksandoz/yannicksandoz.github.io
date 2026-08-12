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
  'data-vx-', 'data-lib-add', 'data-a-prim'
];

/**
 * Hôtes tiers. `ko-fi.com` n'y figure pas : le chapeau ouvre une page de
 * paiement AU CLIC, ce qui est un lien, pas une requête au chargement.
 * `poly.pizza` en revanche ne doit jamais apparaître : l'API n'est appelée
 * que par le mode Auteur, et une scène exportée référence des fichiers
 * locaux, jamais une URL Poly Pizza.
 */
const HOTES_INTERDITS = ['poly.pizza', 'api.poly', 'unpkg.com', 'cdn.jsdelivr', 'googleapis.com'];

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
