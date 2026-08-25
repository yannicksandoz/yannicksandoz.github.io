/**
 * Ce que les cartels DISENT, et rien de ce qui les dessine.
 *
 * À part de `cartels.js`, qui importe le fichier de police (`.woff`, une
 * affaire d'empaqueteur) : ce qui décide de quelque chose doit pouvoir
 * s'éprouver au nœud, sans navigateur. C'est la même règle que pour les
 * `*-reglages.js` du son, et elle a déjà servi une fois — voir
 * `test-console.mjs`.
 */

/** Le violet pâle des étiquettes, et le vert d'une salle épuisée. */
export const ENCRE = 0xcfc8ff;
export const ENCRE_FINI = 0x8fe0c0;

/**
 * Les caractères qu'on affiche à peu près toujours.
 *
 * Sert à faire calculer la carte SDF D'AVANCE : sans cela, le premier cartel
 * posé attend son worker et l'on voit un trou là où le nom devrait être. Il
 * couvre le latin accentué du français, les chiffres, la ponctuation
 * courante et la puce des comptes.
 *
 * IL NE CONTIENT QUE CE QU'INTER SAIT DESSINER, et ce n'est pas une
 * précaution de style. Troika embarque un résolveur de polices de repli :
 * un caractère hors de la police livrée déclenche une requête vers
 * `cdn.jsdelivr.net`, silencieusement, à l'affichage — et rediriger cette
 * adresse ne sert à rien, son code retombe sur le CDN d'origine en cas
 * d'échec. La seule protection est de ne jamais lui présenter un caractère
 * inconnu. `test-cartels.mjs` lit la table `cmap` du `.woff` livré et le
 * vérifie, sur ce jeu ET sur tous les noms du contenu réel.
 *
 * C'est ainsi qu'on a découvert que le losange « ◆ » des comptes, affiché
 * sur CHAQUE porte, n'existe pas dans le sous-ensemble latin d'Inter — qui
 * ne contient aucune forme géométrique. La puce « • », si.
 */
export const GLYPHES_COURANTS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  + 'ÀÂÄÇÈÉÊËÎÏÔÖÙÚÛÜàâäçèéêëîïôöùúûüÿœŒæÆ'
  + '0123456789 •·/–—’\'"«»()[].,;:!?%&+-_°';

/**
 * Le texte d'une étiquette de portail : le nom de la salle, et sous lui ce
 * qu'elle contient.
 *
 * Un nom seul ne dit pas s'il vaut le détour. Le compte, lui, promet sans
 * rien dévoiler : on apprend qu'il y a quatre œuvres derrière cette porte et
 * qu'on en connaît une, jamais lesquelles.
 *
 * `bilan` à null — on ne sait pas encore, la progression n'existe pas au
 * moment où la porte se construit — ou un total nul : on n'écrit que le nom.
 * Une porte qui annonce « • 0 / 0 » ne renseigne sur rien et salit le linteau.
 */
export function texteEtiquette(nom, bilan) {
  const titre = String(nom ?? '').trim();
  const total = Number(bilan?.total);
  if (!Number.isFinite(total) || total <= 0) return titre;
  const vues = Math.max(0, Math.min(total, Number(bilan.vues) || 0));
  return titre ? `${titre}\n• ${vues} / ${total}` : `• ${vues} / ${total}`;
}

/**
 * La couleur d'une étiquette : tout trouvé, la porte le dit d'une teinte,
 * sans un mot de plus. C'est la seule récompense de l'exploration qui ne
 * coûte pas une ligne de texte.
 */
export function encreEtiquette(bilan) {
  const total = Number(bilan?.total);
  if (!Number.isFinite(total) || total <= 0) return ENCRE;
  return (Number(bilan.vues) || 0) >= total ? ENCRE_FINI : ENCRE;
}

/**
 * Ce que `texteEtiquette` produirait et que la police préchargée ne couvre
 * pas. Vide = rien à recalculer au premier affichage.
 */
export function glyphesManquants(texte, glyphes = GLYPHES_COURANTS) {
  const connus = new Set(glyphes);
  const absents = new Set();
  for (const c of String(texte ?? '')) {
    if (c === '\n' || connus.has(c)) continue;
    absents.add(c);
  }
  return [...absents];
}
