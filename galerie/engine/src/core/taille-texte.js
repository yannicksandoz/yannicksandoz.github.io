/**
 * LA TAILLE DU TEXTE — un réglage du menu de la visite.
 *
 * Le zoom de page est interdit dans la galerie (`touch-action: none` : un
 * double tap zoomait la page entière et la scène ne laissait plus dézoomer).
 * Un malvoyant n'a donc pas le pincement pour agrandir les panneaux — menu,
 * fiche d'œuvre, visite audio, catalogue. Ce réglage fait ce travail : trois
 * crans sur la taille de police de la racine, dont tout le HUD descend (rem).
 * La scène 3D, elle, ne bouge pas. Le choix se mémorise dans le navigateur.
 *
 * Règles pures (testées au nœud) ; `appliquerTaille` touche le document.
 */
export const TAILLES = ['normale', 'grande', 'tresgrande'];
const POURCENT = { normale: 100, grande: 118, tresgrande: 136 };
export const CLE_TAILLE = 'galerie-taille';

/** Un cran connu, ou « normale ». */
export function normaliserTaille(valeur) {
  return TAILLES.includes(valeur) ? valeur : 'normale';
}

/** Le pourcentage de la taille de police de la racine pour ce cran. */
export function pourcentDe(taille) {
  return POURCENT[normaliserTaille(taille)];
}

/** Le cran mémorisé (stockage refusé ou vide : « normale »). */
export function lireTaille(stockage = null) {
  try {
    const s = stockage ?? globalThis.localStorage;
    return normaliserTaille(s?.getItem(CLE_TAILLE));
  } catch { return 'normale'; }
}

/** Mémorise le cran — « normale » efface la clé plutôt que d'écrire le défaut. */
export function ecrireTaille(taille, stockage = null) {
  try {
    const s = stockage ?? globalThis.localStorage;
    if (!s) return;
    const t = normaliserTaille(taille);
    if (t === 'normale') s.removeItem(CLE_TAILLE); else s.setItem(CLE_TAILLE, t);
  } catch { /* stockage refusé : le réglage vaut pour cette page */ }
}

/** Applique le cran à la racine du document ; rend le pourcentage posé. */
export function appliquerTaille(taille, racine = globalThis.document?.documentElement) {
  const t = normaliserTaille(taille);
  const p = POURCENT[t];
  if (racine) {
    racine.style.fontSize = p === 100 ? '' : `${p}%`;
    racine.dataset.taille = t;
  }
  return p;
}
