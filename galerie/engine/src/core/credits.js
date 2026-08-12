/**
 * Crédits — côté visiteur.
 *
 * Séparé de `library.js` **exprès** : la bibliothèque est un outil d'auteur
 * et son chargeur de catalogue n'a rien à faire dans le bundle d'un
 * visiteur. Ces deux fonctions-là, si : l'écran de crédits est une page
 * publique, et une licence CC-BY oblige à citer.
 *
 * Une œuvre porte son crédit sous la forme :
 *   "credit": { "author": "…", "license": "CC-BY 4.0", "sourceUrl": "https://…" }
 */

/** Crédit d'une entrée de catalogue, ou null s'il n'y a rien à citer. */
export function creditOf(item) {
  if (!item?.author && !item?.license && !item?.sourceUrl) return null;
  const credit = {};
  if (item.author) credit.author = item.author;
  if (item.license) credit.license = item.license;
  if (item.sourceUrl) credit.sourceUrl = item.sourceUrl;
  return credit;
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
