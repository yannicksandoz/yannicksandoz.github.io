/**
 * LES PORTES DU CHAPEAU — la règle, pure.
 *
 * L'écran de fin (« soutenir l'artiste », modules/TipJar.js) s'ouvre par
 * trois portes, toutes atteignables :
 *   • DÉCOUVERTE : toutes les œuvres découvertes PAR CETTE VISITE (le
 *     catalogue est mémorisé d'une session à l'autre : sans `nouvelles`,
 *     un visiteur qui revient recevait l'écran de fin à son premier pas) ;
 *   • DURÉE : `seuil` minutes de visite (flâner compte aussi) — mais pas
 *     pendant la visite guidée, qui n'est pas à interrompre ;
 *   • FIN : le bouton « Terminer la visite » du menu, à tout moment (elle ne
 *     passe pas par ici : c'est un geste, pas une observation).
 * Rend la porte qui s'ouvre, ou null. Une fois montré, plus jamais.
 */
export function porteDuChapeau({ complet = false, nouvelles = 0, minutes = 0, seuil = 12, deriveActive = false, dejaMontre = false } = {}) {
  if (dejaMontre) return null;
  if (complet && nouvelles > 0) return 'decouverte';
  if (Number.isFinite(minutes) && minutes >= seuil && !deriveActive) return 'duree';
  return null;
}
