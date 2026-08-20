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
 * Sons de l'œuvre venus d'ailleurs que du projet — mêmes obligations que
 * les modèles, et pour la même raison.
 *
 * Le contrôle ne regardait que `model.source` : une œuvre « monolithe + son
 * Freesound CC-BY » passait l'export sans la moindre citation, alors que la
 * licence l'exige et que le panneau d'import l'annonçait comme bloquante.
 * Un son est une œuvre au même titre qu'un modèle ; ici plus qu'ailleurs,
 * puisque c'est une galerie sonore.
 */
export function sonsImportes(work) {
  return (work?.stems ?? [])
    .map((stem, index) => ({ stem, index }))
    .filter(({ stem }) => Boolean(stem?.source));
}

/**
 * Champs manquants pour une œuvre donnée. Tableau vide = conforme.
 *
 * Seuls les modèles importés sont contraints : une primitive, une
 * construction voxel ou une œuvre personnelle n'ont personne à citer.
 */
export function validateWorkCredit(work) {
  const manquants = [];
  if (isImported(work)) {
    if (!String(work.title ?? '').trim()) manquants.push('name');
    const credit = work.credit ?? {};
    for (const champ of CHAMPS_REQUIS) {
      if (!String(credit[champ] ?? '').trim()) manquants.push(champ);
    }
  }
  // Les sons importés se signalent par un préfixe : l'auteur doit savoir
  // LEQUEL de ses trois stems n'est pas cité, pas seulement qu'il en manque.
  for (const { stem, index } of sonsImportes(work)) {
    const credit = stem.credit ?? {};
    for (const champ of CHAMPS_REQUIS) {
      if (!String(credit[champ] ?? '').trim()) manquants.push(`son${index + 1}.${champ}`);
    }
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
  const dire = (m) => {
    const son = /^son(\d+)\.(.+)$/.exec(m);
    return son ? `son n° ${son[1]} : ${noms[son[2]] ?? son[2]}` : (noms[m] ?? m);
  };
  return fautes.map((f) =>
    `• « ${f.title || f.id} » : ${f.missing.map(dire).join(', ')}`
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

/**
 * Fichier compagnon d'un SON importé, écrit à côté de lui. Même rôle que
 * celui d'un modèle : effacer le crédit du JSON de scène ne suffit pas à
 * le perdre, il faut aussi effacer un fichier qu'on n'a aucune raison
 * d'ouvrir.
 */
export function attributionFileSon(stem) {
  return {
    name: String(stem?.file ?? '').split('/').pop(),
    author: stem?.credit?.author ?? '',
    license: stem?.credit?.license ?? '',
    sourceUrl: stem?.credit?.sourceUrl ?? '',
    source: stem?.source ?? '',
    audio: stem?.file ?? '',
    note: "Attribution du son voisin. Conservez ce fichier avec lui : "
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
  const ajouter = (c, titre) => {
    if (!c) return;
    const key = `${c.author}|${c.license}|${c.sourceUrl}`;
    const entry = seen.get(key) ?? { ...c, titles: [] };
    if (!entry.titles.includes(titre)) entry.titles.push(titre);
    seen.set(key, entry);
  };
  for (const work of works ?? []) {
    const titre = work.title || work.id;
    ajouter(work.credit, titre);
    // Un son emprunté se cite lui aussi, sur la page publique des crédits :
    // le stocker dans le JSON sans jamais l'afficher ne serait pas citer.
    for (const { stem } of sonsImportes(work)) ajouter(stem.credit, titre);
  }
  return [...seen.values()];
}

/** Sources tierces citées par la scène (pour la mention obligatoire). */
export function collectSources(works) {
  return [...new Set((works ?? [])
    .flatMap((w) => [w.model?.source, ...sonsImportes(w).map(({ stem }) => stem.source)])
    .filter((s) => s && s !== 'library' && s !== 'locale'))];
}
