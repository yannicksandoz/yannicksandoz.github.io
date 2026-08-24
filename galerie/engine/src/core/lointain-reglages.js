/**
 * LE LOINTAIN — un seul réglage, par œuvre.
 *
 * `audio.lointain` dans la configuration d'une œuvre : 0 = elle sonne là où
 * elle est, 1 = elle sonne comme si on ne pouvait jamais l'atteindre. Voir
 * `lointain-worklet.js` pour ce que ça fait au signal, et `air-reglages.js`
 * pour la distance ORDINAIRE — celle qu'on parcourt — qui, elle, est
 * automatique et ne se règle pas par œuvre.
 *
 * Séparé de `Lointain.js` parce que celui-ci importe le worklet en `?raw` :
 * un fichier illisible hors navigateur, donc intestable. Ici, tout est pur.
 */

/** Au-dessous, on ne branche rien : un worklet par œuvre se mérite. */
export const SEUIL = 0.01;

/**
 * Quelques repères pour l'inspecteur — ce ne sont pas des paliers, la valeur
 * reste continue. Ils disent seulement ce que l'oreille entend arriver.
 */
export const REPERES = [
  [0, 'ici'],
  [0.25, 'de l’autre côté de la salle'],
  [0.5, 'au fond d’un couloir'],
  [0.75, 'derrière une colline'],
  [1, 'hors d’atteinte']
];

export function normaliserLointain(brut) {
  const n = Number(brut);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Le repère le plus proche, pour l'afficher à côté du curseur. */
export function repereLointain(valeur) {
  const v = normaliserLointain(valeur);
  let meilleur = REPERES[0];
  for (const r of REPERES) {
    if (Math.abs(r[0] - v) < Math.abs(meilleur[0] - v)) meilleur = r;
  }
  return meilleur[1];
}
