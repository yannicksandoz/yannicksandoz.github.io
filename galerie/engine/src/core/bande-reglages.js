/**
 * Les réglages de la bande.
 *
 * À part de `Bande.js`, qui charge la source du worklet (`?raw`) : ce qui
 * décide de quelque chose doit pouvoir s'éprouver au nœud.
 */

export const BANDE_DEFAUTS = {
  // ÉTEINTE PAR DÉFAUT, comme le pupitre et la couleur : c'est un parti pris
  // sur le son de toute la galerie, pas une correction.
  actif: false,
  // Les deux gains sont CENTRÉS sur la moitié : ±12 dB de part et d'autre.
  // Entrer fort dans une bande, c'est la saturer — c'est le geste, pas un
  // défaut de niveau.
  entree: 0.5,
  sortie: 0.5,
  // combien l'aigu s'écrase quand il dépasse
  douceur: 0.3,
  // le poids de la tête de lecture, dans le bas
  bosse: 0.35,
  // combien la vitesse de défilement dérive. Au-delà de la moitié, ça
  // s'entend comme une cassette fatiguée et non comme une bande.
  pleurage: 0.25,
  melange: 1
};

/** Réglages relus et bornés — un JSON écrit à la main n'est pas de confiance. */
export function normaliserBande(brut) {
  const c = { ...BANDE_DEFAUTS, ...(brut ?? {}) };
  const borne = (v, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : repli;
  };
  return {
    actif: c.actif === true,
    entree: borne(c.entree, BANDE_DEFAUTS.entree),
    douceur: borne(c.douceur, BANDE_DEFAUTS.douceur),
    bosse: borne(c.bosse, BANDE_DEFAUTS.bosse),
    pleurage: borne(c.pleurage, BANDE_DEFAUTS.pleurage),
    sortie: borne(c.sortie, BANDE_DEFAUTS.sortie),
    melange: borne(c.melange, BANDE_DEFAUTS.melange)
  };
}
