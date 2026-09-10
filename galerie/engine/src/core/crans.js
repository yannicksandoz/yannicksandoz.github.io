/**
 * LES CRANS — la qualité qui descend, décrite comme une liste.
 *
 * Le gouverneur (Quality.js) décide toutes les trois secondes ; ce fichier
 * dit DANS QUEL ORDRE il cède, sans toucher au renderer : de l'état courant
 * (un objet plat) il tire le prochain cran à prendre. Pur, testé au nœud.
 *
 * FINITION (entre 27 et la cadence visée) : ce qui se voit le moins pour ce
 * que ça coûte — l'anticrénelage, l'occlusion ambiante, puis les OMBRES,
 * les ÉCRANS ISF à demi-résolution, les APPARITIONS figées, la densité
 * ramenée à 1. Avant, cet étage s'arrêtait à l'occlusion : une machine à
 * 30–45 images restait là, ni fluide ni dégradée, faute de crans.
 *
 * SURVIE (sous 27) : la densité SOUS le natif (jusqu'à 0,75, affûtée par la
 * sortie — le plus gros levier d'un GPU qui manque de fill-rate), le grain,
 * le bloom.
 *
 * MODE ÉCONOME : tout de suite tout en bas, au choix du visiteur (menu →
 * Réglages, ou `?eco`), mémorisé ; le gouverneur ne remonte jamais.
 */

export const FINITION = [
  { cle: 'msaa2', si: (e) => e.msaa > 2, dit: 'anticrénelage ×2' },
  { cle: 'msaa0', si: (e) => e.msaa > 0, dit: 'anticrénelage désactivé' },
  { cle: 'gtao', si: (e) => e.gtao, dit: 'occlusion ambiante désactivée' },
  { cle: 'ombres', si: (e) => e.ombres, dit: 'ombres désactivées' },
  { cle: 'isf', si: (e) => e.isf > 256, dit: 'écrans ISF à demi-résolution' },
  { cle: 'apparitions', si: (e) => e.apparitions, dit: 'apparitions figées' },
  { cle: 'densite1', si: (e) => e.pixelRatio > 1, dit: 'densité 1' }
];

export const SURVIE = [
  { cle: 'densite', si: (e) => e.pixelRatio > 0.75, dit: 'densité sous le natif' },
  { cle: 'grain', si: (e) => e.grain, dit: 'grain désactivé' },
  { cle: 'bloom', si: (e) => e.bloom, dit: 'bloom désactivé' }
];

/** Le prochain cran d'une liste que l'état permet encore, ou null. */
export function prochainCran(etat, liste) {
  return liste.find((c) => c.si(etat)) ?? null;
}

/** L'état plat que lisent les crans, depuis le profil et ce qui vit dans l'app. */
export function etatDe(profile, app) {
  return {
    msaa: Number(profile?.msaa) || 0,
    gtao: Boolean(app?.gtao?.enabled),
    ombres: Boolean(profile?.shadows),
    isf: Number(profile?.isfResolution) || 512,
    apparitions: Boolean(app?.vistas?.live),
    pixelRatio: Number(profile?.pixelRatio) || 1,
    grain: Boolean(profile?.grain),
    bloom: Boolean(app?.sortie?.bloomActif)
  };
}

/** Le plancher de densité en survie, par pas de 0,25 : 1 → 0,75, jamais moins. */
export function densiteSuivante(pixelRatio) {
  return Math.max(0.75, Math.round((pixelRatio - 0.25) * 100) / 100);
}

/** Ce que le mode économe impose au profil, avant même le renderer. */
export const ECONOME = Object.freeze({
  pixelRatio: 1, nettete: 0.5, msaa: 0, gtao: false, shadows: false, shadowMapSize: 1024,
  isfResolution: 256, bloomResScale: 0.25, anisotropy: 4, grain: false, dustCount: 150
});

export const CLE_ECONOME = 'galerie-eco';

/** Le mode économe est-il demandé ? `?eco` (ou `?eco=0` pour l'ôter), sinon la mémoire. */
export function lireEconome(search = '', stockage = null) {
  const params = new URLSearchParams(search ?? '');
  if (params.has('eco')) {
    const v = params.get('eco');
    return !(v === '0' || v === 'false' || v === 'non');
  }
  try { return stockage?.getItem?.(CLE_ECONOME) === '1'; } catch { return false; }
}

export function ecrireEconome(actif, stockage = null) {
  try {
    if (actif) stockage?.setItem?.(CLE_ECONOME, '1');
    else stockage?.removeItem?.(CLE_ECONOME);
    return true;
  } catch { return false; }
}
