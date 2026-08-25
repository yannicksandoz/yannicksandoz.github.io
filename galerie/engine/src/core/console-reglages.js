/**
 * Les réglages de la table de mixage, et les deux courbes de Console6.
 *
 * À part de `Console.js`, qui charge la source du worklet de Console7
 * (`?raw`) : ce qui décide de quelque chose doit pouvoir s'éprouver au nœud,
 * sans navigateur ni empaqueteur.
 */

export const POINTS = 8192;

/** Encodage d'une tranche — Console6Channel. */
export function encoder(x) {
  if (x > 1) return 1;
  if (x > 0) return x * (2 - x);
  if (x < -1) return -1;
  if (x < 0) return x * (x + 2);
  return 0;
}

/** Décodage du bus — Console6Buss, réciproque exacte de l'encodage. */
export function decoder(x) {
  if (x > 1) return 1;
  if (x > 0) return x / (1 + Math.sqrt(1 - x));
  if (x < -1) return -1;
  if (x < 0) return x / (Math.sqrt(x + 1) + 1);
  return 0;
}

export function courbe(fn) {
  const c = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i++) c[i] = fn((i / (POINTS - 1)) * 2 - 1);
  return c;
}

/**
 * Réglages relus et bornés.
 *
 * ÉTEINTE par défaut, et à pleine attaque quand on l'allume : c'est le
 * réglage de Chris, celui qu'on veut entendre pour juger. À moitié attaque
 * la table s'entend à peine — autant ne pas la brancher.
 */
export const CONSOLE_DEFAUTS = { actif: false, attaque: 1, moteur: 'console6' };

/**
 * Les deux tables, et ce qu'elles coûtent.
 *
 * La SIX est une paire de courbes sans mémoire, donc deux `WaveShaperNode`
 * natifs par tranche : le navigateur les calcule en code compilé, et c'est
 * gratuit. La SEPT a de la mémoire — deux passe-bas et un fader poursuivi —
 * donc un AudioWorklet par tranche, en JavaScript, dans le fil audio.
 *
 * C'est pour cela que la six reste le défaut : elle ne coûte rien, et sur
 * une machine qui tient déjà quinze convolutions HRTF, trois réverbes et
 * cinq étages de maître, ce n'est pas un détail.
 */
export const MOTEURS_CONSOLE = {
  console6: { nom: 'Console6', desc: 'deux courbes réciproques, natives — gratuite' },
  console7: { nom: 'Console7', desc: 'deux harmoniques mêlées, un worklet par tranche' }
};

export function normaliserConsole(brut) {
  const c = { ...CONSOLE_DEFAUTS, ...(brut ?? {}) };
  const a = Number(c.attaque);
  return {
    // Seul un `true` franc l'allume : c'est une couleur livrée éteinte, et
    // une valeur douteuse dans un JSON ne doit pas la brancher à l'insu de
    // l'auteur.
    actif: c.actif === true,
    // jamais zéro : ce serait une division par zéro dans le gain de rendu
    attaque: Number.isFinite(a) ? Math.min(1, Math.max(0.05, a)) : CONSOLE_DEFAUTS.attaque,
    moteur: MOTEURS_CONSOLE[c.moteur] ? c.moteur : CONSOLE_DEFAUTS.moteur
  };
}
