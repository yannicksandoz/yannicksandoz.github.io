/**
 * Les réglages de l'hygiène du maître, et les coefficients qui vont avec.
 *
 * À part de `Hygiene.js`, qui charge la source du worklet (`?raw`) : ce qui
 * décide de quelque chose doit pouvoir s'éprouver au nœud.
 */

export const HYGIENE_DEFAUTS = {
  aigus: true,   // Ultrasonic — le coupe-haut, au-dessus de l'audible
  graves: true   // Infrasonic — le coupe-bas, en dessous
};

/** Les deux fréquences de Chris : les bornes de ce qu'une oreille entend. */
export const AIGUS_HZ = 20000;
export const GRAVES_HZ = 20;

/**
 * Les cinq Q d'un Butterworth d'ordre dix en cinq biquads.
 *
 * Ce sont les valeurs de Chris, et ce ne sont pas des goûts : un Butterworth
 * d'ordre dix a cinq paires de pôles, et ces cinq Q sont exactement celles-là.
 * Changer l'une d'elles ne rend pas le filtre « plus doux », elle le rend
 * faux — la platitude de la bande passante vient de leur accord.
 */
export const Q_BUTTERWORTH = [
  0.50623256, 0.56116312, 0.70710678, 1.10134463, 3.19622661
];

/**
 * La fréquence de coupure réellement utilisable à ce taux d'échantillonnage.
 *
 * ÉCART ASSUMÉ AU PLUGIN D'ORIGINE. Chris pose 20 kHz sans condition : ses
 * plugins tournent dans une station, à 44,1 kHz au moins. Le navigateur, lui,
 * ouvre parfois un contexte à 22 050 Hz — et 20 kHz passe alors au-dessus de
 * Nyquist, `tan(π·f/taux)` devient négatif et le biquad part en oscillation.
 * On borne donc à 0,46 fois le taux : à 44,1 et 48 kHz cela ne mord pas (la
 * borne vaut 20 286 et 22 080 Hz), et en dessous cela garde un filtre stable
 * au lieu d'un bruit.
 */
export function coupureUtile(hz, taux) {
  const t = Number(taux) > 0 ? Number(taux) : 48000;
  return Math.min(Number(hz) || 0, t * 0.46);
}

/**
 * Les coefficients d'un biquad, dans la forme de Chris (K = tan(π·f/taux)).
 *
 * C'est la forme du livre de recettes RBJ, celle qu'implémente aussi le
 * `BiquadFilterNode` du navigateur — d'où le repli natif de `Hygiene.js`,
 * qui n'est pas une approximation mais le même filtre par un autre chemin.
 *
 * Rend `{ b0, b1, b2, a1, a2 }`, prêts pour une forme directe I.
 */
export function coefficientsBiquad(type, hz, taux, q) {
  const f = coupureUtile(hz, taux) / (Number(taux) > 0 ? Number(taux) : 48000);
  const K = Math.tan(Math.PI * f);
  const norm = 1.0 / (1.0 + (K / q) + (K * K));
  const a1 = 2.0 * ((K * K) - 1.0) * norm;
  const a2 = (1.0 - (K / q) + (K * K)) * norm;
  if (type === 'haut') {           // coupe-bas : on garde le haut
    return { b0: norm, b1: -2.0 * norm, b2: norm, a1, a2 };
  }
  const b0 = K * K * norm;         // coupe-haut : on garde le bas
  return { b0, b1: 2.0 * b0, b2: b0, a1, a2 };
}

/** Réglages relus — un JSON écrit à la main n'est pas de confiance. */
export function normaliserHygiene(brut) {
  const c = { ...HYGIENE_DEFAUTS, ...(brut ?? {}) };
  return { aigus: c.aigus !== false, graves: c.graves !== false };
}
