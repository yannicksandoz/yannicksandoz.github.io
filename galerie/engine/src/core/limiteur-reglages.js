/**
 * Les réglages du limiteur, et rien d'autre.
 *
 * À part du reste parce que `Limiteur.js` charge la source du worklet
 * (`?raw`, une affaire de bundler) : ces quelques fonctions doivent pouvoir
 * s'éprouver au nœud, sans navigateur ni empaqueteur, comme tout ce qui
 * décide de quelque chose.
 */

/**
 * Les deux plafonds, et ce qui les sépare.
 *
 * La QUATRE est Pressure4 suivi de ClipOnly2 : deux étages qu'il faut
 * accorder l'un à l'autre, et un réglage de saturation (`caractere`) pour
 * doser le grain du premier.
 *
 * La CINQ est Pressure5, qui est le tout d'un bloc — et Chris y a ajouté
 * deux passe-bas fixes à 24 kHz (un détecteur qui voit de l'ultrasonique
 * réagit à ce que personne n'entend) et « PawClaw », qui module la courbe
 * par la PENTE du signal : patte de velours sur ce qui bouge doucement,
 * griffe sur ce qui attaque.
 *
 * La cinq est le défaut. La quatre reste là pour comparer — un plafond se
 * juge à l'oreille sur du vrai contenu, pas sur un argument.
 */
export const MOTEURS_LIMITEUR = {
  pressure5: { nom: 'Pressure5', desc: 'le tout d’un bloc, avec PawClaw' },
  pressure4: { nom: 'Pressure4 + ClipOnly2', desc: 'deux étages, réglage de grain' }
};

export const LIMITEUR_DEFAUTS = {
  actif: true,
  // LA DERNIÈRE VERSION PAR DÉFAUT. Voir MOTEURS_LIMITEUR ci-dessus.
  moteur: 'pressure5',
  // Propres à la cinq : la griffe (0,5 au neutre) et le mélange.
  griffe: 0.5,
  melange: 1,
  // LA MARGE, avant tout le reste : de combien on baisse la somme AVANT de
  // la limiter. Ce n'est pas un goût, c'est une mesure — trois œuvres du
  // labo somment à 1,27 en approchant, et le second étage passait son temps
  // à raboter les crêtes à son plafond (0,955), ce qui s'entend comme une
  // saturation permanente dès qu'on est proche. Une table de mixage ne
  // répare pas cela en serrant davantage : elle baisse l'entrée. 0,75 laisse
  // deux décibels et demi de marge, assez pour que le limiteur ne travaille
  // plus que sur les vraies crêtes.
  marge: 0.75,
  pression: 0.25,   // A — combien le limiteur serre
  // Rendre le gain de rattrapage de Pressure4 : sans cela, brancher le
  // limiteur monte TOUTE la galerie de +3,5 dB et pousse le moindre son
  // dans la saturation du second étage. On veut un plafond, pas une
  // couleur permanente — et l'on veut pouvoir comparer en le coupant.
  compenser: true,
  // Dose de la saturation sinus de Pressure4 : 0 = plafond transparent
  // (ClipOnly2 tient déjà les crêtes), 1 = le grain du plugin d'origine.
  caractere: 0,
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
    // jamais zéro : une marge nulle rendrait la galerie muette, et un JSON
    // qui se trompe de champ ne doit pas pouvoir couper le son
    marge: borne(c.marge, 0.05, 2, LIMITEUR_DEFAUTS.marge),
    compenser: c.compenser !== false,
    caractere: borne(c.caractere, 0, 1, LIMITEUR_DEFAUTS.caractere),
    pression: borne(c.pression, 0, 1, LIMITEUR_DEFAUTS.pression),
    vitesse: borne(c.vitesse, 0, 1, LIMITEUR_DEFAUTS.vitesse),
    douceur: borne(c.douceur, 0, 1, LIMITEUR_DEFAUTS.douceur),
    sortie: borne(c.sortie, 0, 2, LIMITEUR_DEFAUTS.sortie),
    moteur: MOTEURS_LIMITEUR[c.moteur] ? c.moteur : LIMITEUR_DEFAUTS.moteur,
    griffe: borne(c.griffe, 0, 1, LIMITEUR_DEFAUTS.griffe),
    melange: borne(c.melange, 0, 1, LIMITEUR_DEFAUTS.melange)
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
