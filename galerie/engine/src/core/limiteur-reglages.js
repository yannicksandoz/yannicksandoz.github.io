/**
 * Les réglages du limiteur, et rien d'autre.
 *
 * À part du reste parce que `Limiteur.js` charge la source du worklet
 * (`?raw`, une affaire de bundler) : ces quelques fonctions doivent pouvoir
 * s'éprouver au nœud, sans navigateur ni empaqueteur, comme tout ce qui
 * décide de quelque chose.
 */

export const LIMITEUR_DEFAUTS = {
  actif: true,
  pression: 0.35,   // A — combien le limiteur serre
  vitesse: 0.5,     // B — la vitesse de relâchement
  douceur: 0.5,     // C — 0,5 neutre ; en dessous ça s'étale, au-dessus ça tient
  sortie: 1         // D — le niveau de sortie
};

/** Réglages relus et bornés — un JSON édité à la main n'est pas de confiance. */
export function normaliserLimiteur(brut) {
  const c = { ...LIMITEUR_DEFAUTS, ...(brut ?? {}) };
  const borne = (v, min, max, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : repli;
  };
  return {
    actif: c.actif !== false,
    pression: borne(c.pression, 0, 1, LIMITEUR_DEFAUTS.pression),
    vitesse: borne(c.vitesse, 0, 1, LIMITEUR_DEFAUTS.vitesse),
    douceur: borne(c.douceur, 0, 1, LIMITEUR_DEFAUTS.douceur),
    sortie: borne(c.sortie, 0, 2, LIMITEUR_DEFAUTS.sortie)
  };
}

/**
 * Coefficient de gain → décibels de réduction (toujours ≤ 0).
 *
 * Un coefficient impossible — zéro, NaN, plus grand que 1 — rend 0 plutôt
 * qu'un `-Infinity` : c'est un afficheur, et une aiguille qui part au bout du
 * cadran ferait croire à une panne du son alors qu'il n'y a qu'une mesure
 * manquée.
 */
export function reductionEnDb(coefficient) {
  const c = Number(coefficient);
  if (!Number.isFinite(c) || c <= 0) return 0;
  return Math.min(0, 20 * Math.log10(Math.min(1, c)));
}
