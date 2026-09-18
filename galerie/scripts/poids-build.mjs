/**
 * LE POIDS DU BUILD — un garde-fou de livraison, dans la chaîne de
 * publication.
 *
 * Trois mesures sur `dist/` : le PAQUET PRINCIPAL (le plus gros
 * `assets/index-*.js`, celui que tout visiteur télécharge avant la
 * première image), le TOTAL DU JAVASCRIPT (paquet, three, chargeurs,
 * worklets, morceaux à la demande), et le TOTAL DU SITE HORS MÉDIAS (tout
 * ce qui n'est ni son, ni image, ni modèle, ni vidéo : le code, les
 * styles, les pages, les configurations, les polices). Chaque mesure a un
 * seuil (`poids-seuils.json`, en octets : les valeurs d'un build connu
 * plus dix pour cent de marge) ; un build qui le dépasse fait ÉCHOUER la
 * publication, en nommant le fichier fautif et son dépassement — pour le
 * paquet, le fichier lui-même ; pour un total, les plus gros fichiers qui
 * y entrent.
 *
 * Pourquoi un garde-fou et non un chiffre dans un rapport : un paquet qui
 * grossit de cent kilo-octets ne se voit pas — c'est ce qui est arrivé
 * quand douze worklets sont entrés dans le paquet en `?raw`, commentaires
 * compris. Le seuil transforme la dérive en rouge, le jour même.
 *
 * Quand une croissance est VOULUE (une bibliothèque de plus, un module
 * lourd), on relève le seuil dans `poids-seuils.json`, dans le même
 * commit, et l'on dit pourquoi dans le message : le garde-fou n'interdit
 * pas de grossir, il interdit de grossir sans le savoir.
 *
 *   node scripts/poids-build.mjs [dist]        le contrôle (rouge si dépassé)
 *   node scripts/poids-build.mjs [dist] --mesure   les mesures seules
 *
 * La logique est pure (`mesurer`, `verdict`, `texteRapport`) et éprouvée
 * au nœud par `test-poids-build.mjs`, qui lance aussi le contrôle sur
 * `dist/` quand il existe — donc `npm test` en CI, après le build.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ce qui est un MÉDIA : hors du total « site hors médias ». */
export const EXTENSIONS_MEDIAS = new Set([
  // son
  '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm', '.wav', '.aiff', '.aif', '.flac',
  // image
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.exr', '.hdr', '.ktx2', '.basis',
  // modèle et scan
  '.glb', '.gltf', '.bin', '.obj', '.mtl', '.splat', '.ply',
  // vidéo
  '.mp4', '.mov'
]);

const MESURES = [
  { cle: 'paquetPrincipal', nom: 'paquet principal' },
  { cle: 'jsTotal', nom: 'JavaScript total' },
  { cle: 'siteHorsMedias', nom: 'site hors médias' }
];

/**
 * Les trois mesures, d'après une liste de `{ chemin, taille }` (chemins
 * relatifs à la racine du build, séparateur `/`). Rend aussi, pour chaque
 * total, les fichiers qui y entrent, du plus lourd au plus léger.
 */
export function mesurer(fichiers) {
  const js = fichiers.filter((f) => extname(f.chemin) === '.js');
  const horsMedias = fichiers.filter((f) => !EXTENSIONS_MEDIAS.has(extname(f.chemin).toLowerCase()));
  const parPoids = (l) => [...l].sort((a, b) => b.taille - a.taille);
  const paquets = parPoids(js.filter((f) => /(^|\/)assets\/index-[\w-]+\.js$/.test(f.chemin)));
  const somme = (l) => l.reduce((n, f) => n + f.taille, 0);
  return {
    paquetPrincipal: { taille: paquets[0]?.taille ?? 0, fichiers: paquets.slice(0, 1) },
    jsTotal: { taille: somme(js), fichiers: parPoids(js) },
    siteHorsMedias: { taille: somme(horsMedias), fichiers: parPoids(horsMedias) }
  };
}

/**
 * Le verdict : pour chaque mesure au-dessus de son seuil, un manquement
 * qui nomme le fautif (le paquet lui-même, ou les trois plus gros fichiers
 * d'un total) et le dépassement. Sans seuil pour une mesure, rien à dire.
 */
export function verdict(mesures, seuils) {
  const manquements = [];
  for (const { cle, nom } of MESURES) {
    const seuil = Number(seuils?.[cle]);
    const m = mesures[cle];
    if (!m || !Number.isFinite(seuil) || seuil <= 0) continue;
    if (m.taille <= seuil) continue;
    const depassement = m.taille - seuil;
    const fautifs = m.fichiers.slice(0, cle === 'paquetPrincipal' ? 1 : 3)
      .map((f) => `${f.chemin} (${ko(f.taille)})`);
    manquements.push({
      cle, nom, taille: m.taille, seuil, depassement,
      fichier: m.fichiers[0]?.chemin ?? null,
      message: `${nom} : ${ko(m.taille)} pour un seuil de ${ko(seuil)}, `
        + `dépassé de ${ko(depassement)} (${(100 * depassement / seuil).toFixed(1)} %) — `
        + (cle === 'paquetPrincipal' ? `fichier fautif : ${fautifs[0]}` : `les plus lourds : ${fautifs.join(', ')}`)
    });
  }
  return manquements;
}

/** Le rapport lisible : chaque mesure, son seuil, la marge qui reste. */
export function texteRapport(mesures, seuils = {}) {
  const lignes = [];
  for (const { cle, nom } of MESURES) {
    const m = mesures[cle];
    const seuil = Number(seuils?.[cle]);
    const reste = Number.isFinite(seuil) && seuil > 0
      ? (m.taille <= seuil ? `marge ${ko(seuil - m.taille)}` : `DÉPASSÉ de ${ko(m.taille - seuil)}`)
      : 'sans seuil';
    lignes.push(`${nom.padEnd(18)} ${ko(m.taille).padStart(11)}`
      + (Number.isFinite(seuil) && seuil > 0 ? `   seuil ${ko(seuil).padStart(11)}   ${reste}` : `   ${reste}`)
      + (cle === 'paquetPrincipal' && m.fichiers[0] ? `   ${m.fichiers[0].chemin}` : ''));
  }
  return lignes.join('\n');
}

/** Des octets en kilo-octets lisibles (1 ko = 1000 octets, comme le réseau). */
export function ko(octets) {
  return `${(octets / 1000).toFixed(octets >= 100000 ? 0 : 1)} ko`;
}

/** Tous les fichiers d'un dossier, en `{ chemin, taille }` relatifs. */
export async function lireDossier(racine) {
  const resultat = [];
  const marcher = async (dossier) => {
    for (const e of await readdir(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, e.name);
      if (e.isDirectory()) await marcher(chemin);
      else if (e.isFile()) resultat.push({ chemin: relative(racine, chemin).split('\\').join('/'), taille: (await stat(chemin)).size });
    }
  };
  await marcher(racine);
  return resultat;
}

export const FICHIER_SEUILS = join(dirname(fileURLToPath(import.meta.url)), 'poids-seuils.json');

/** Le contrôle complet sur un dossier ; rend { mesures, manquements }. */
export async function controler(racine, seuils) {
  const fichiers = await lireDossier(racine);
  const mesures = mesurer(fichiers);
  return { mesures, manquements: verdict(mesures, seuils) };
}

// ------------------------------------------------------------- ligne de commande
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const mesureSeule = args.includes('--mesure');
  const racine = args.find((a) => !a.startsWith('--')) ?? 'dist';
  try { await stat(racine); } catch {
    console.error(`✗ ${racine}/ introuvable — lancez d'abord « npm run build ».`);
    process.exit(1);
  }
  const seuils = mesureSeule ? {} : JSON.parse(await readFile(FICHIER_SEUILS, 'utf8'));
  const { mesures, manquements } = await controler(racine, seuils);
  console.log(`poids du build (${racine}/) :\n${texteRapport(mesures, seuils)}`);
  if (manquements.length) {
    for (const m of manquements) {
      console.error(`✗ ${m.message}`);
      // l'annotation de GitHub Actions : le manquement, sur le fichier fautif
      if (process.env.GITHUB_ACTIONS) console.log(`::error file=galerie/scripts/poids-seuils.json,title=poids du build::${m.message}`);
    }
    console.error(`\nUn dépassement voulu se déclare dans ${relative(process.cwd(), FICHIER_SEUILS)}, dans le même commit, avec sa raison.`);
    process.exit(1);
  }
  if (!mesureSeule) console.log('✓ le build tient dans ses seuils.');
}
