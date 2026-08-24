/**
 * L'AIR — ce que la distance fait au timbre, et pas seulement au niveau.
 *
 * Jusqu'ici, s'éloigner d'une œuvre ne faisait que baisser son volume. Or
 * l'oreille ne juge pas la distance au volume : elle la juge au TIMBRE et au
 * rapport direct/réverbération. Un son lointain est SOURD — l'air absorbe
 * les aigus, d'autant plus qu'il y en a à traverser — et il est NOYÉ : la
 * part réfléchie ne faiblit pas comme la part directe.
 *
 * Ce fichier tient les deux lois, séparées du reste pour être éprouvées au
 * nœud. Elles ne portent aucun code d'Airwindows : ce sont deux formules de
 * physique, et le bon outil pour la première est un filtre natif du
 * navigateur, un par voie. Un worklet par source aurait coûté quinze fois
 * plus cher pour faire ce qu'un biquad fait en code natif.
 *
 * 1. LA COUPURE. Un passe-bas dont la fréquence tombe avec la distance :
 *
 *      fc = 20 000 / (1 + d / dRef)
 *
 *    À `dRef` mètres, l'aigu est coupé à 10 kHz ; à trois fois `dRef`, à
 *    5 kHz. Un plancher empêche une source très lointaine de devenir un
 *    grondement : au-delà, elle s'efface par le gain, pas par le filtre.
 *
 * 2. LE RAPPORT DIRECT/RÉVERBE. Dans une pièce, passé la distance critique,
 *    le niveau de la réverbération ne bouge presque plus : c'est le DIRECT
 *    qui tombe. Comme le départ vers la réverbe est pris après l'atténuation
 *    de distance, il tombait avec lui et le rapport restait figé. On le
 *    compense — le départ remonte de ce que la distance a ôté, borné pour
 *    qu'une œuvre à l'autre bout d'un belvédère ne devienne pas une nappe.
 */

export const AIR_DEFAUTS = {
  actif: true,
  // mètres où l'aigu tombe à 10 kHz. 12 m : une grande salle reste claire,
  // un belvédère de cinquante mètres devient franchement lointain.
  distance: 12,
  // 0 = pas d'air du tout, 1 = la loi entière. Un intermédiaire garde
  // l'indice sans assourdir une galerie qui vit de ses aigus.
  intensite: 1,
  // Combien le départ vers la réverbe rattrape la distance. 0 = le rapport
  // direct/réverbe reste figé (l'ancien comportement), 1 = la réverbe garde
  // son niveau quand on s'éloigne.
  reverbDistance: 0.75
};

/** La plus basse coupure qu'on s'autorise : en dessous, ce n'est plus un son. */
export const PLANCHER = 1200;
const PLAFOND = 20000;

export function normaliserAir(brut) {
  const c = { ...AIR_DEFAUTS, ...(brut ?? {}) };
  const borne = (v, min, max, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : repli;
  };
  return {
    actif: c.actif !== false,
    distance: borne(c.distance, 1, 200, AIR_DEFAUTS.distance),
    intensite: borne(c.intensite, 0, 1, AIR_DEFAUTS.intensite),
    reverbDistance: borne(c.reverbDistance, 0, 1, AIR_DEFAUTS.reverbDistance)
  };
}

/**
 * Fréquence de coupure pour cette distance, en hertz.
 *
 * Rend le plafond (donc : aucun effet) quand l'air est coupé ou l'intensité
 * nulle — un filtre à 20 kHz ne fait rien d'audible, et le laisser en place
 * évite de rebrancher le graphe à chaque changement de réglage.
 */
export function coupureAir(distance, reglages) {
  const r = normaliserAir(reglages);
  if (!r.actif || r.intensite <= 0) return PLAFOND;
  const d = Math.max(0, Number(distance) || 0);
  const physique = PLAFOND / (1 + (d / r.distance));
  // l'intensité mélange en OCTAVES, pas en hertz : à mi-chemin entre
  // 20 kHz et 5 kHz, l'oreille attend 10 kHz, pas 12,5 kHz
  const melange = PLAFOND * ((physique / PLAFOND) ** r.intensite);
  return Math.max(PLANCHER, Math.min(PLAFOND, melange));
}

/**
 * Facteur à appliquer au départ de réverbe pour rattraper la distance.
 *
 * `gainDistance` est ce que l'atténuation a laissé passer (1 = tout près).
 * Borné à huit : une œuvre presque inaudible ne doit pas remplir la pièce
 * de sa seule queue, et une atténuation qui tend vers zéro ferait diverger
 * la compensation.
 */
export function compensationReverb(gainDistance, reglages) {
  const r = normaliserAir(reglages);
  const g = Number(gainDistance);
  if (!Number.isFinite(g) || g <= 0) return 1;
  if (r.reverbDistance <= 0) return 1;
  const plein = 1 / Math.max(g, 1e-3);
  const dose = plein ** r.reverbDistance;
  return Math.max(1, Math.min(8, dose));
}
