/**
 * DEUX PRÉFÉRENCES DE VISITE, mémorisées dans le navigateur :
 *
 *   • la visite AUDIO — on l'a choisie une fois : la prochaine ouverture
 *     propose directement l'oreille (le focus de l'accueil se pose sur
 *     « Visite audio »), et `?mode=audio` dans un lien fait pareil ;
 *   • les REPÈRES SONORES — de petits sons d'interface (découverte, jeton,
 *     passage franchi ou fermé, espace complet), pour qui ne lit pas la
 *     zone d'annonces. Allumés d'office en visite audio, éteints en 3D,
 *     sauf choix contraire au menu.
 *
 * Règles pures ; le stockage est injectable pour les tests.
 */
export const CLE_AUDIO = 'galerie-visite-audio';
export const CLE_REPERES = 'galerie-reperes';

const lire = (cle, stockage) => {
  try { return (stockage ?? globalThis.localStorage)?.getItem(cle) ?? null; } catch { return null; }
};
const ecrire = (cle, valeur, stockage) => {
  try {
    const s = stockage ?? globalThis.localStorage;
    if (!s) return;
    if (valeur === null) s.removeItem(cle); else s.setItem(cle, valeur);
  } catch { /* stockage refusé : la préférence vaut pour cette page */ }
};

/** La visite audio est-elle préférée ? `?mode=audio` l'emporte, puis la mémoire. */
export function visiteAudioPreferee(search = '', stockage = null) {
  try {
    if (new URLSearchParams(search).get('mode') === 'audio') return true;
  } catch { /* search illisible */ }
  return lire(CLE_AUDIO, stockage) === '1';
}

/** Mémoriser le choix (false efface la clé). */
export function ecrireVisiteAudio(choisie, stockage = null) {
  ecrire(CLE_AUDIO, choisie ? '1' : null, stockage);
}

/**
 * Les repères sonores : 'oui', 'non', ou null (pas de choix — le défaut
 * dépend du mode : oui en visite audio, non en 3D).
 */
export function lireReperes(stockage = null) {
  const v = lire(CLE_REPERES, stockage);
  return v === '1' ? 'oui' : v === '0' ? 'non' : null;
}

export function ecrireReperes(choix, stockage = null) {
  ecrire(CLE_REPERES, choix === 'oui' ? '1' : choix === 'non' ? '0' : null, stockage);
}

/** Faut-il jouer les repères ? */
export function reperesActifs(choix, visiteAudio) {
  if (choix === 'oui') return true;
  if (choix === 'non') return false;
  return Boolean(visiteAudio);
}
