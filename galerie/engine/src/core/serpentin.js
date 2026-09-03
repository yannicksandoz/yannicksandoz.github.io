/**
 * LA LOI DU SERPENTIN — la part PURE du serpentement des masses voxel.
 *
 * En style fluide, une masse gravissable (escalier, rampe) cesse d'être une
 * barre orthogonale : elle ondoie en plan (S doux, extrémités FIXES pour que
 * les connexions du labyrinthe tiennent) et s'ÉLARGIT — un peu partout, et
 * davantage en son milieu. Ce module ne sait rien du style courant ni de
 * three : il rend la loi pour des dimensions données, et c'est `style.js`
 * qui décide de l'appliquer (`serpentinVoxel`). Le rendu fusionné, le
 * collider ET la charte (règle des seuils) appliquent LA MÊME loi — la
 * marche reste exactement sur la forme, et un portail « dans » une volée
 * est jugé sur la volée telle qu'elle se voit, pas sur sa grille droite.
 *
 * Rend null si la masse n'est pas nettement allongée ; sinon
 * { axe, decalage(t), gonflement(t) } où t est la progression le long de
 * l'axe long (0..1).
 */

/**
 * Largeur aux EXTRÉMITÉS, en multiple de la largeur nominale. Une volée
 * de sept cellules à 24 cm ne fait que 1,68 m : à largeur nominale, le
 * pied — là où l'on s'engage, et où le décalage latéral du serpent se
 * ressent le plus — était trop fin pour être emprunté d'un pas sûr. On
 * l'élargit d'un cinquième d'un bout à l'autre, et le milieu gonfle encore
 * par-dessus. Les extrémités ne BOUGENT toujours pas (décalage nul) : la
 * connexion au palier tient, elle est seulement plus large que lui.
 */
export const BASE_SERPENTIN = 1.2;
export const GONFLEMENT_SERPENTIN = 0.24;

export function loiSerpentin(dims, cell) {
  const lx = dims[0] * cell, lz = dims[2] * cell;
  const long = Math.max(lx, lz), larg = Math.min(lx, lz);
  if (long < 5 || long < larg * 2.2) return null;
  const axe = lx >= lz ? 0 : 2;
  // L'AMPLITUDE SE PREND SUR LA LONGUEUR, plus sur la largeur : une volée
  // étroite ne doit pas se contenter d'un frisson de dix centimètres. Elle
  // reste bornée par sa propre largeur — c'est ce qui garantit qu'une
  // marche recouvre encore largement la précédente : le décalage latéral
  // d'un pas au suivant vaut au pire A·8,3/nombre de marches. Coefficients
  // ramenés de 0,17 à 0,06 de la longueur et de 0,7 à 0,29 de la largeur :
  // à 1,18 m sur une volée de 7,7 m, le S se lisait comme un toboggan et
  // une volée s'écartait de sa voie de près de 5 m de dessin — rien ne
  // pouvait plus se coller à un mur. À 0,46 m, il ondoie encore, et la
  // bande qu'une volée balaie (2,9 m de dessin) tient sous la poitrine du
  // visiteur qui marche sur le mur voisin — c'est ce qui permet aux volées
  // du belvédère de longer les murs (genere-belvedere.py, VOIE).
  // (Port en Python dans scripts/genere-belvedere.py, `loi_serpentin` :
  // les deux doivent changer ensemble.)
  const A = Math.min(long * 0.06, larg * 0.29);
  const phase = ((dims[0] * 3 + dims[1] * 5 + dims[2] * 7) % 13) / 13 * Math.PI * 2;
  // DEUX ONDES plutôt qu'une : la porteuse donne le grand S, l'harmonique
  // le repentir en son milieu — une vraie sinuosité, pas un arc. L'enveloppe
  // sin(π t) s'annule aux deux bouts : les extrémités de la volée ne bougent
  // pas d'un millimètre, et les connexions du labyrinthe tiennent.
  // TROIS lobes : gauche, droite, gauche. Une porteuse à deux lobes ne
  // faisait qu'un S — un arc, pas un serpent ; il faut au moins trois
  // ventres pour que le regard lise une sinuosité en montant.
  const forme = (t) => Math.sin(Math.PI * t) * (
    0.70 * Math.sin(Math.PI * 3 * t + phase)
    + 0.32 * Math.sin(Math.PI * 5 * t + 1.6 * phase));
  // Le maximum du couple dépend de la phase : on le RELÈVE une fois pour
  // toutes plutôt que de le supposer. Sans ça, l'amplitude réelle valait
  // selon la volée la moitié ou les trois quarts de celle qu'on croyait
  // demander, et deux escaliers voisins ondulaient inégalement.
  let crete = 0;
  for (let i = 0; i <= 240; i++) crete = Math.max(crete, Math.abs(forme(i / 240)));
  const g = crete > 1e-6 ? A / crete : 0;
  return {
    axe,
    decalage: (t) => g * forme(t),
    gonflement: (t) => BASE_SERPENTIN + GONFLEMENT_SERPENTIN * Math.sin(Math.PI * t)
  };
}

/**
 * L'INVERSE du serpentement : un point du repère de l'objet, tel qu'il se
 * voit (serpenté), ramené à sa place dans la grille droite — de quoi lire
 * la cellule qui l'occupe. `local` est [x, y, z] en mètres, grille centrée
 * en x/z ; rend une copie corrigée.
 */
export function deserpenter(loi, dims, cell, local) {
  if (!loi) return local;
  const l = [...local];
  if (loi.axe === 2) {
    const t = (l[2] / cell + dims[2] / 2) / dims[2];
    l[0] = (l[0] - loi.decalage(t)) / loi.gonflement(t);
  } else {
    const t = (l[0] / cell + dims[0] / 2) / dims[0];
    l[2] = (l[2] - loi.decalage(t)) / loi.gonflement(t);
  }
  return l;
}
