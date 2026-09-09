/**
 * LES LIENS — une entrée de shader (ou du sol) suit le son d'une œuvre.
 *
 * Jusqu'ici un écran ISF ne pouvait suivre que SON propre niveau, sur UNE
 * entrée (`model.audio`). Une salle vit de plusieurs sons : le dancefloor
 * doit s'allumer sur la pulsation d'une autre œuvre, le chat ouvrir la
 * bouche sur une voix, une dalle suivre les basses et une autre les aigus.
 * D'où les liens, dans le JSON de ce qui écoute :
 *
 *   "liens": [
 *     { "entree": "brightness", "oeuvre": "pulsation", "signal": "basse", "min": 0.2, "max": 1.4 },
 *     { "entree": "mouth_open", "oeuvre": "voix",      "signal": "niveau" }
 *   ]
 *
 * `entree` nomme l'entrée (INPUT ISF, ou paramètre du sol) ; `oeuvre` l'id
 * de l'œuvre écoutée — de la même pièce, sinon rien ne s'entend — ; `signal`
 * ce qu'on en tire (voir SIGNAUX) ; `min` et `max` la plage parcourue quand
 * le signal va de `bas` à `haut` (par défaut : de la valeur de repos au
 * maximum de l'entrée, quand le signal va de 0 à 1). La résolution est
 * PURE : un lien, l'entrée, le signal → la valeur. Les analyses vivent dans
 * Signaux, les uniforms dans les écrans.
 *
 * LA FENÊTRE DU SIGNAL. Un signal mesuré ne parcourt presque jamais 0..1 :
 * les basses d'une pulsation oscillent entre 0,59 et 0,88, une voix entre
 * 0,1 et 0,5. Sans fenêtre, l'entrée ne bouge que sur ce tiers de sa plage
 * et le sol « frémit » au lieu de battre. `bas` et `haut` disent où le
 * signal vit : à `bas` l'entrée vaut `min`, à `haut` elle vaut `max`. Le
 * vu-mètre de l'éditeur mesure la fenêtre atteinte et l'écrit d'un bouton.
 *
 * L'ENVELOPPE. Entre le son et le paramètre, un suiveur d'enveloppe, comme
 * l'Envelope Follower d'Ableton : `attaque` et `retombee` (ms) disent à
 * quelle vitesse la course monte vers le signal et redescend — 0 = tout de
 * suite ; `courbe` bombe la réponse (1 : droite ; < 1 : réagit tôt, comme
 * un log ; > 1 : réagit tard, comme une expo) ; `inverse` retourne la
 * course (le sol s'éteint sur la grosse caisse). L'ordre est fixe :
 * signal × gain → fenêtre [bas, haut] → enveloppe → courbe → inverse →
 * plage [min, max] — et avant tout cela, le passe-bande (signal `bande`,
 * `hz`) choisit ce qu'on écoute. L'enveloppe a un ÉTAT (la course précédente) : les
 * appelants le gardent par lien (`etats`, une Map par entrée) et passent
 * dt ; tout le calcul reste pur.
 */

/** L'enveloppe par défaut : nette à l'attaque, un peu de tenue à la retombée. */
export const ENVELOPPE_DEFAUT = { attaque: 20, retombee: 150, courbe: 1, inverse: false };

/** Ce qu'on peut tirer du son d'une œuvre, et comment le dire. */
export const SIGNAUX = [
  { cle: 'niveau', etiquette: 'niveau (tout le spectre)' },
  { cle: 'basse', etiquette: 'basses (20–250 Hz)' },
  { cle: 'medium', etiquette: 'médiums (250–2 000 Hz)' },
  { cle: 'aigu', etiquette: 'aigus (2–8 kHz)' },
  { cle: 'crete', etiquette: 'crêtes (attaques, retombée lente)' },
  { cle: 'bande', etiquette: 'bande à choisir (Hz)' }
];

/** Les bornes d'une bande à choisir, en Hz : ce que l'analyseur peut lire. */
export const HZ_MIN = 10;
export const HZ_MAX = 20000;
export const BANDE_DEFAUT = [80, 4000];

/**
 * LE PASSE-BANDE. Avant le suiveur d'enveloppe, un filtre simple : deux
 * fréquences, et le lien n'écoute que ce qu'il y a entre — la grosse caisse
 * seule (40–120 Hz), une voix (200–3 000), un charley (6–12 k). C'est le
 * signal `bande`, avec `hz: [bas, haut]` ; les quatre bandes toutes faites
 * (basse, medium, aigu, niveau) restent, ce sont des raccourcis.
 */
export function normaliserHz(hz) {
  const [a, b] = Array.isArray(hz) ? hz : [];
  let lo = Number.isFinite(a) ? a : BANDE_DEFAUT[0];
  let hi = Number.isFinite(b) ? b : BANDE_DEFAUT[1];
  lo = Math.max(HZ_MIN, Math.min(HZ_MAX, lo));
  hi = Math.max(HZ_MIN, Math.min(HZ_MAX, hi));
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi - lo < 1) hi = Math.min(HZ_MAX, lo + 1);
  return [lo, hi];
}

const CLES_SIGNAUX = new Set(SIGNAUX.map((s) => s.cle));

/**
 * Nettoie un lien du JSON : rend null s'il ne dit pas au moins une entrée
 * et une œuvre ; un signal inconnu devient `niveau`.
 */
export function normaliserLien(lien) {
  if (!lien || typeof lien !== 'object') return null;
  const entree = typeof lien.entree === 'string' ? lien.entree.trim() : '';
  const oeuvre = typeof lien.oeuvre === 'string' ? lien.oeuvre.trim() : '';
  if (!entree || !oeuvre) return null;
  const n = (v) => (Number.isFinite(v) ? v : undefined);
  // la fenêtre du signal : 0..1 sauf si les deux bornes se tiennent
  let bas = Number.isFinite(lien.bas) ? Math.max(0, Math.min(1, lien.bas)) : 0;
  let haut = Number.isFinite(lien.haut) ? Math.max(0, Math.min(1, lien.haut)) : 1;
  if (haut - bas < 1e-3) { bas = 0; haut = 1; }
  const ms = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.min(60000, v) : d);
  const signal = CLES_SIGNAUX.has(lien.signal) ? lien.signal : 'niveau';
  return {
    entree, oeuvre, signal,
    hz: signal === 'bande' ? normaliserHz(lien.hz) : undefined,
    min: n(lien.min), max: n(lien.max),
    bas, haut,
    gain: Number.isFinite(lien.gain) && lien.gain > 0 ? lien.gain : 1,
    attaque: ms(lien.attaque, ENVELOPPE_DEFAUT.attaque),
    retombee: ms(lien.retombee, ENVELOPPE_DEFAUT.retombee),
    courbe: Number.isFinite(lien.courbe) && lien.courbe > 0 ? Math.max(0.1, Math.min(10, lien.courbe)) : 1,
    inverse: lien.inverse === true
  };
}

/**
 * Un pas du suiveur d'enveloppe : la course précédente va vers la cible à
 * la vitesse de l'attaque (si elle monte) ou de la retombée (si elle
 * descend), en millisecondes de constante de temps ; 0 = tout de suite.
 * Pur : rend la nouvelle course.
 */
export function suivreEnveloppe(precedent, cible, dt, lien) {
  const c = Math.max(0, Math.min(1, Number(cible) || 0));
  if (!Number.isFinite(precedent)) return c;
  const tau = c >= precedent ? (lien?.attaque ?? ENVELOPPE_DEFAUT.attaque) : (lien?.retombee ?? ENVELOPPE_DEFAUT.retombee);
  if (!(tau > 0) || !(dt > 0)) return c;
  return precedent + (c - precedent) * (1 - Math.exp(-(dt * 1000) / tau));
}

/** La courbe puis l'inversion, sur une course 0..1. */
export function faconnerCourse(lien, course) {
  let c = Math.max(0, Math.min(1, Number(course) || 0));
  const k = lien?.courbe ?? 1;
  if (k !== 1) c = Math.pow(c, k);
  return lien?.inverse ? 1 - c : c;
}

/**
 * La course d'un lien À TRAVERS son enveloppe, avec état : `etats` est une
 * Map (par entrée) que l'appelant garde d'une image à l'autre. Rend la
 * course façonnée (0..1), prête pour la plage.
 */
export function courseSuivie(lien, signal, etats, dt) {
  const brut = courseDuSignal(lien, signal);
  const cle = lien.entree;
  const prec = etats?.get(cle);
  const suivi = suivreEnveloppe(prec, brut, dt, lien);
  etats?.set(cle, suivi);
  return faconnerCourse(lien, suivi);
}

/**
 * Une entrée depuis une COURSE déjà calculée (0..1) : bool à mi-course,
 * float de min à max, borné aux limites de l'entrée.
 */
export function valeurDeCourse(lien, entree, s, repos) {
  if (!lien || !entree) return null;
  if (entree.type === 'bool') return s >= 0.5;
  if (entree.type !== 'float') return null;
  const base = Number.isFinite(Number(repos)) ? Number(repos) : (Number(entree.defaut) || 0);
  const min = Number.isFinite(lien.min) ? lien.min : base;
  const max = Number.isFinite(lien.max) ? lien.max
    : (Number.isFinite(entree.max) ? entree.max : base + 1);
  let v = min + s * (max - min);
  if (Number.isFinite(entree.min)) v = Math.max(entree.min, v);
  if (Number.isFinite(entree.max)) v = Math.min(entree.max, v);
  return v;
}

/**
 * La valeur d'une entrée pour un signal, à travers l'enveloppe du lien —
 * ce que les écrans, le sol et l'éditeur appellent à chaque image.
 */
export function resoudreLienSuivi(lien, entree, signal, repos, etats, dt) {
  if (!lien || !entree) return null;
  return valeurDeCourse(lien, entree, courseSuivie(lien, signal, etats, dt), repos);
}

/**
 * La fenêtre à écrire depuis une plage OBSERVÉE du signal (le vu-mètre de
 * l'éditeur) : arrondie au centième, ouverte d'un rien de chaque côté pour
 * que les extrêmes tiennent dedans, et jamais plus étroite que 0,05 — une
 * fenêtre nulle ferait basculer l'entrée comme un interrupteur.
 */
export function fenetreObservee(min, max) {
  let bas = Math.floor((Number(min) || 0) * 100) / 100;
  let haut = Math.ceil((Number(max) || 0) * 100) / 100;
  if (haut - bas < 0.05) { const c = (bas + haut) / 2; bas = c - 0.025; haut = c + 0.025; }
  bas = Math.max(0, Math.min(0.95, bas));
  haut = Math.max(bas + 0.05, Math.min(1, haut));
  return { bas: Math.round(bas * 100) / 100, haut: Math.round(haut * 100) / 100 };
}

/**
 * Les liens d'un modèle ISF : `model.liens`, plus l'ancien `model.audio`
 * ({ entree, gain } : le niveau de l'œuvre elle-même) traduit en lien.
 */
export function liensDuModele(model, oeuvreId) {
  const liste = (Array.isArray(model?.liens) ? model.liens : []).map(normaliserLien).filter(Boolean);
  const ancien = model?.audio;
  if (ancien?.entree && oeuvreId && !liste.some((l) => l.entree === ancien.entree)) {
    liste.push({ entree: String(ancien.entree), oeuvre: oeuvreId, signal: 'niveau', hz: undefined,
      min: undefined, max: undefined, bas: 0, haut: 1,
      gain: Number.isFinite(ancien.gain) && ancien.gain > 0 ? ancien.gain : 1,
      ...ENVELOPPE_DEFAUT });
  }
  return liste;
}

/**
 * La valeur d'une entrée pour un signal donné, SANS enveloppe (instantané :
 * les tests, et l'aperçu). Courbe et inversion s'appliquent.
 * @param {object} lien  normalisé
 * @param {object} entree  { nom, type, defaut, min, max } (isf.js / dancefloor.js)
 * @param {number} signal  0..1 (peut dépasser : borné ici)
 * @param {*} repos  la valeur de repos (réglage de l'œuvre, sinon le défaut)
 * @returns {number|boolean|null}  null si l'entrée n'est pas liable
 */
export function resoudreLien(lien, entree, signal, repos) {
  if (!lien || !entree) return null;
  return valeurDeCourse(lien, entree, faconnerCourse(lien, courseDuSignal(lien, signal)), repos);
}

/**
 * Où en est le signal dans sa fenêtre : 0 à `bas`, 1 à `haut`, borné —
 * après le gain. C'est la course qui parcourt min → max.
 */
export function courseDuSignal(lien, signal) {
  const v = (Number(signal) || 0) * (lien?.gain ?? 1);
  const bas = Number.isFinite(lien?.bas) ? lien.bas : 0;
  const haut = Number.isFinite(lien?.haut) && lien.haut > bas ? lien.haut : 1;
  return Math.max(0, Math.min(1, (v - bas) / (haut - bas)));
}

/**
 * CE QU'UNE PIÈCE PEUT FAIRE SUIVRE AU SON : ses lumières. Des entrées à la
 * forme ISF, mais ce sont des MULTIPLICATEURS (1 = le réglage de la pièce
 * tel quel) : la lumière clé, l'ambiante, l'ambiance d'environnement (IBL),
 * la densité du brouillard. `room.liens` les nomme comme un shader nomme
 * les siennes ; RoomManager les applique à chaque image.
 */
export const ENTREES_PIECE = [
  { nom: 'keyLight', type: 'float', defaut: 1, min: 0, max: 3, etiquette: 'lumière clé (× intensité)' },
  { nom: 'ambient', type: 'float', defaut: 1, min: 0, max: 3, etiquette: 'lumière ambiante (× intensité)' },
  { nom: 'env', type: 'float', defaut: 1, min: 0, max: 3, etiquette: 'ambiance IBL (× intensité)' },
  { nom: 'fog', type: 'float', defaut: 1, min: 0, max: 4, etiquette: 'brouillard (× densité)' }
];

/**
 * Les multiplicateurs d'une pièce pour cette image : { nom → valeur } pour
 * chaque lien valide dont l'entrée existe. `valeur(lien)` donne le signal ;
 * `etats` garde les enveloppes ; pur par ailleurs.
 */
export function multiplicateursPiece(liens, valeur, etats, dt) {
  const m = {};
  for (const brut of Array.isArray(liens) ? liens : []) {
    const lien = normaliserLien(brut);
    if (!lien) continue;
    const e = ENTREES_PIECE.find((x) => x.nom === lien.entree);
    if (!e) continue;
    const v = resoudreLienSuivi(lien, e, valeur(lien), 1, etats, dt);
    if (v !== null) m[e.nom] = v;
  }
  return m;
}

/**
 * Le portail PORTÉ par une œuvre : dans la pièce, une entrée de `portals`
 * dont `via` est l'id de l'œuvre. Pas de porte à ce portail-là — l'œuvre
 * est la porte ; la carte et le test des passages, eux, voient un portail
 * comme les autres. Rend l'entrée, ou null.
 */
export function portailPorte(roomConfig, oeuvreId) {
  if (!oeuvreId) return null;
  return (roomConfig?.portals ?? []).find((p) => p && p.via === oeuvreId && p.to) ?? null;
}
