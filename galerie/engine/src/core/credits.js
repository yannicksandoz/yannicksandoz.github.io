/**
 * Attribution des modèles importés — côté visiteur.
 *
 * Séparé de `library.js` **exprès** : la bibliothèque est un outil d'auteur
 * et son chargeur de catalogue n'a rien à faire dans le bundle d'un
 * visiteur. Ces fonctions-là, si : l'écran de crédits est une page publique,
 * et une licence CC-BY oblige à citer.
 *
 * ## L'attribution est un invariant, pas une convention
 *
 * Un crédit doit survivre à tout — y compris à un client qui reprend la
 * galerie et modifie le JSON à la main. Trois mécanismes s'y emploient, et
 * il faut les trois :
 *
 *   1. **Champs requis** — un modèle importé sans `name`, `author`,
 *      `license` et `sourceUrl` complets est invalide (`validateWorkCredit`).
 *   2. **Export bloqué** — l'éditeur refuse d'exporter une scène invalide.
 *      Un refus, pas un avertissement : un avertissement se contourne.
 *   3. **Fichier compagnon** — l'attribution est aussi écrite à côté de
 *      l'asset (`<modèle>.attribution.json`). Effacer le crédit du JSON ne
 *      suffit donc pas à le perdre : le runtime le relit sur le disque.
 *
 * Un modèle porte `model.source` dès qu'il vient d'ailleurs que du projet.
 * C'est ce marqueur qui rend l'obligation détectable — et le fichier
 * compagnon qui la rend irréversible.
 */

/** Champs d'attribution exigés pour tout modèle importé. */
export const CHAMPS_REQUIS = ['author', 'license', 'sourceUrl'];

/** Crédit d'une entrée de catalogue, ou null s'il n'y a rien à citer. */
export function creditOf(item) {
  if (!item?.author && !item?.license && !item?.sourceUrl) return null;
  const credit = {};
  if (item.author) credit.author = item.author;
  if (item.license) credit.license = item.license;
  if (item.sourceUrl) credit.sourceUrl = item.sourceUrl;
  return credit;
}

/** Vrai si l'œuvre porte un modèle venu d'une source extérieure au projet. */
export function isImported(work) {
  return Boolean(work?.model?.source);
}

/**
 * Champs manquants pour une œuvre donnée. Tableau vide = conforme.
 *
 * Seuls les modèles importés sont contraints : une primitive, une
 * construction voxel ou une œuvre personnelle n'ont personne à citer.
 */
export function validateWorkCredit(work) {
  if (!isImported(work)) return [];
  const manquants = [];
  if (!String(work.title ?? '').trim()) manquants.push('name');
  const credit = work.credit ?? {};
  for (const champ of CHAMPS_REQUIS) {
    if (!String(credit[champ] ?? '').trim()) manquants.push(champ);
  }
  return manquants;
}

/**
 * Contrôle d'une scène entière. Renvoie la liste des œuvres fautives, avec
 * ce qui leur manque — de quoi écrire un message que l'auteur peut suivre.
 */
export function validateScene(works) {
  const fautes = [];
  for (const work of works ?? []) {
    const manquants = validateWorkCredit(work);
    if (manquants.length) {
      fautes.push({ id: work.id, title: work.title ?? '', missing: manquants });
    }
  }
  return fautes;
}

/** Message d'erreur destiné à l'auteur, listant chaque manque. */
export function describeSceneFaults(fautes) {
  const noms = {
    name: 'nom', author: 'auteur', license: 'licence', sourceUrl: 'URL source'
  };
  return fautes.map((f) =>
    `• « ${f.title || f.id} » : ${f.missing.map((m) => noms[m] ?? m).join(', ')}`
  ).join('\n');
}

/**
 * Contenu du fichier compagnon écrit à côté d'un asset importé.
 *
 * Volontairement lisible et autonome : quelqu'un qui trouve ce fichier
 * dans un dossier, des années plus tard, sait quoi citer sans rien d'autre.
 */
export function attributionFile(work) {
  return {
    name: work.title ?? work.id,
    author: work.credit?.author ?? '',
    license: work.credit?.license ?? '',
    sourceUrl: work.credit?.sourceUrl ?? '',
    source: work.model?.source ?? '',
    model: work.model?.url ?? '',
    note: "Attribution du modèle voisin. Conservez ce fichier avec lui : "
        + "il porte l'obligation de citation, indépendamment de la scène."
  };
}

/** Chemin du fichier compagnon pour une URL de modèle. */
export function attributionPath(modelUrl) {
  return `${String(modelUrl).split('?')[0]}.attribution.json`;
}

/**
 * Crédits d'une scène, dédupliqués — dix socles du même auteur ne font
 * qu'une ligne, avec la liste des objets concernés.
 */
export function collectCredits(works) {
  const seen = new Map();
  for (const work of works ?? []) {
    const c = work.credit;
    if (!c) continue;
    const key = `${c.author}|${c.license}|${c.sourceUrl}`;
    const entry = seen.get(key) ?? { ...c, titles: [] };
    entry.titles.push(work.title || work.id);
    seen.set(key, entry);
  }
  return [...seen.values()];
}

/** Sources tierces citées par la scène (pour la mention obligatoire). */
export function collectSources(works) {
  return [...new Set((works ?? [])
    .map((w) => w.model?.source)
    .filter((s) => s && s !== 'library'))];
}
