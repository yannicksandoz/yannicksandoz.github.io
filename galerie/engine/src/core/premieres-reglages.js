/**
 * Les premières réflexions, côté réglages.
 *
 * À part du worklet parce que celui-ci est chargé en TEXTE (`?raw`) puis
 * exécuté dans le fil audio : il ne peut rien importer, tout doit y tenir.
 * Ce qui décide de quelque chose vit donc ici, où le nœud sait le lire.
 *
 * LES PLACES ASSISES SONT ÉCRITES DEUX FOIS — ici pour l'inspecteur, et
 * dans `premieres-worklet.js` à côté des longueurs de ligne. C'est une
 * duplication assumée : les deux ne peuvent pas s'importer l'une l'autre, et
 * `scripts/test-premieres.mjs` échoue si les deux listes cessent de dire la
 * même chose. Mieux vaut un test qui crie qu'un import impossible.
 */

/** Le nombre de places de chacune des dix-sept salles de ClearCoat. */
export const PLACES = [96, 107, 135, 143, 166, 189, 225, 252, 255, 323, 427,
  470, 606, 643, 809, 984, 1541];

/** Combien de premières réflexions une pièce renvoie, par défaut. */
export const PREMIERES_DEFAUT = 0.35;

/**
 * De l'ampleur d'une pièce (0 à 1, le même réglage que la queue) à l'une des
 * dix-sept salles.
 *
 * UN SEUL RÉGLAGE POUR LES DEUX MOTEURS, et c'est le point : l'auteur dit
 * une fois que la pièce est grande, la queue s'allonge ET les premiers
 * retours s'éloignent. Deux curseurs auraient permis une petite salle à
 * longue queue — ce qui n'existe pas, et s'entend faux.
 */
export function salleDeTaille(taille) {
  const t = Number(taille);
  const v = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.4;
  return Math.round(v * (PLACES.length - 1));
}

/** Ce qu'on affiche à côté du curseur : « 225 places ». */
export function nomDeSalle(index) {
  const i = Math.max(0, Math.min(PLACES.length - 1, Math.round(index) || 0));
  return `${PLACES[i]} places`;
}

export function normaliserPremieres(brut) {
  const n = Number(brut);
  if (!Number.isFinite(n)) return PREMIERES_DEFAUT;
  return Math.min(1, Math.max(0, n));
}
