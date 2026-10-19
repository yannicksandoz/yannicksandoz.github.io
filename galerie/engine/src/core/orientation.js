/**
 * OÙ SONT LES CHOSES, À L'OREILLE — les règles pures de la visite audio.
 *
 * Une liste d'œuvres dit qu'elles existent ; pour qui ne voit pas l'image,
 * il faut aussi dire OÙ : « Nébuleuse — à gauche, 12 m ». La direction est
 * relative au regard de l'auditeur (huit secteurs de 45°), la distance en
 * mètres entiers. Tout est calculé dans le plan du sol (x, z) : la hauteur
 * ne change pas le côté d'où vient un son.
 *
 * Testé au nœud (scripts/test-orientation.mjs), sans three.js : des
 * objets {x, z} suffisent.
 */

/** Les huit secteurs, dans le sens horaire depuis « devant ». */
export const SECTEURS = ['devant', 'devant-droite', 'droite', 'derriere-droite', 'derriere', 'derriere-gauche', 'gauche', 'devant-gauche'];

/** Le cap du regard (radians, repère x/z) depuis la position vers la cible du regard. */
export function cap(position, regard) {
  return Math.atan2(regard.x - position.x, regard.z - position.z);
}

/**
 * L'angle d'une cible par rapport au regard, en degrés dans ]-180, 180] :
 * 0 devant, positif à droite, négatif à gauche, ±180 derrière.
 * Repère three.js (y vers le haut, x vers la droite quand on regarde -z).
 */
export function angleRelatif(position, regard, cible) {
  const vers = Math.atan2(cible.x - position.x, cible.z - position.z);
  let d = (vers - cap(position, regard)) * 180 / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  // le repère three.js regarde vers -z : un angle croissant tourne vers la gauche
  return -d === 0 ? 0 : -d;
}

/** Le secteur d'un angle relatif (degrés). */
export function secteur(angle) {
  const a = ((angle % 360) + 360) % 360;
  return SECTEURS[Math.round(a / 45) % 8];
}

/** La distance au sol, en mètres. */
export function distanceSol(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** « 12 m », « 3 m », « moins d'un mètre » (texte fourni par l'appelant). */
export function distanceArrondie(d, moinsDUnMetre = '< 1 m') {
  if (!Number.isFinite(d) || d < 0) return '';
  if (d < 1) return moinsDUnMetre;
  return `${Math.round(d)} m`;
}

/** Tout en un : { secteur, angle, distance } d'une cible pour un auditeur. */
export function reperer(position, regard, cible) {
  const angle = angleRelatif(position, regard, cible);
  return { secteur: secteur(angle), angle, distance: distanceSol(position, cible) };
}

/**
 * Le regard pivoté de `degres` autour de l'auditeur (positif : vers la
 * droite), à la même distance : la cible du regard à poser dans l'orbite.
 */
export function pivoter(position, regard, degres) {
  const dx = regard.x - position.x; const dz = regard.z - position.z;
  // vers la droite dans le repère three.js = sens horaire vu de dessus
  const a = degres * Math.PI / 180;
  const c = Math.cos(a); const s = Math.sin(a);
  return { x: position.x + dx * c - dz * s, y: regard.y, z: position.z + dx * s + dz * c };
}

/** Les cibles triées de la plus proche à la plus lointaine, avec leur repère. */
export function classerParDistance(position, regard, cibles) {
  return cibles
    .map((c) => ({ ...c, ...reperer(position, regard, c.position) }))
    .sort((a, b) => a.distance - b.distance);
}
