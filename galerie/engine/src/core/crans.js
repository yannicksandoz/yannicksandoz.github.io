/**
 * LES CRANS — la qualité qui descend, décrite comme une liste.
 *
 * Le gouverneur (Quality.js) décide toutes les trois secondes ; ce fichier
 * dit DANS QUEL ORDRE il cède, sans toucher au renderer : de l'état courant
 * (un objet plat) il tire le prochain cran à prendre. Pur, testé au nœud.
 *
 * UN FILET, PAS UN RÉGLEUR. Le gouverneur a longtemps changé l'IMAGE selon
 * l'appareil — anticrénelage, occlusion, ombres, écrans ISF, apparitions,
 * grain, bloom cédaient l'un après l'autre — et deux visiteurs ne voyaient
 * plus la même galerie. Il ne touche plus qu'à la DENSITÉ : si les images
 * tombent durablement, l'image se rend avec moins de pixels et l'affûtage
 * de la sortie en rattrape une part ; rien ne disparaît, rien ne change
 * de forme, et le son n'est jamais touché. La galerie est la même partout,
 * en un peu plus doux là où la machine manque.
 *
 * FINITION (entre 27 images et la cadence visée) : la densité ramenée à 1.
 * SURVIE (sous 27) : la densité SOUS le natif, jusqu'à 0,75.
 *
 * MODE ÉCONOME : le seul cas où l'image change vraiment — au choix du
 * visiteur (menu → Réglages, ou `?eco`), mémorisé, tout de suite tout en
 * bas par la liste ECONOME_CRANS, qui a gardé les anciens crans.
 */

export const FINITION = [
  { cle: 'densite1', si: (e) => e.pixelRatio > 1, dit: 'densité 1' }
];

export const SURVIE = [
  { cle: 'densite', si: (e) => e.pixelRatio > 0.75, dit: 'densité sous le natif' }
];

/** Ce que le MODE ÉCONOME retire, dans l'ordre — au choix du visiteur seulement. */
export const ECONOME_CRANS = [
  { cle: 'msaa2', si: (e) => e.msaa > 2, dit: 'anticrénelage ×2' },
  { cle: 'msaa0', si: (e) => e.msaa > 0, dit: 'anticrénelage désactivé' },
  { cle: 'gtao', si: (e) => e.gtao, dit: 'occlusion ambiante désactivée' },
  { cle: 'ombres', si: (e) => e.ombres, dit: 'ombres désactivées' },
  { cle: 'isf', si: (e) => e.isf > 256, dit: 'écrans ISF à demi-résolution' },
  { cle: 'etendues', si: (e) => e.etendues > 0, dit: 'sources étendues retirées, lignes de lumière réduites' },
  { cle: 'apparitions', si: (e) => e.apparitions, dit: 'apparitions figées' },
  ...FINITION,
  ...SURVIE,
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
    etendues: Number(profile?.sourcesEtendues) || 0,
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

/**
 * `?gouverneur=0` FIGE le gouverneur : aucun cran ne descend.
 * Pour les sondes qui mesurent l'image (rendu logiciel à trois images par
 * seconde : sans cela, tout est coupé avant la première capture) — jamais
 * pour un visiteur.
 */
export function lireGouverneur(search = '') {
  const params = new URLSearchParams(search ?? '');
  if (!params.has('gouverneur')) return true;
  const v = params.get('gouverneur');
  return !(v === '0' || v === 'false' || v === 'non');
}

/**
 * `?profil=desktop`, `?profil=mobile` ou `?profil=unique` FORCE le profil,
 * quel que soit l'appareil, et sans le rabais des GPU modestes : c'est
 * ainsi qu'on lit, sur un iPhone et avec `?perf=1`, ce que coûte chaque
 * image. « unique » est le candidat d'une seule image pour tous (voir
 * Quality.js). Rend 'desktop', 'mobile', 'unique' ou null.
 */
export function lireProfil(search = '') {
  const v = new URLSearchParams(search ?? '').get('profil');
  if (v === 'desktop' || v === 'bureau') return 'desktop';
  if (v === 'mobile' || v === 'telephone' || v === 'téléphone') return 'mobile';
  if (v === 'unique') return 'unique';
  return null;
}

export function ecrireEconome(actif, stockage = null) {
  try {
    if (actif) stockage?.setItem?.(CLE_ECONOME, '1');
    else stockage?.removeItem?.(CLE_ECONOME);
    return true;
  } catch { return false; }
}
