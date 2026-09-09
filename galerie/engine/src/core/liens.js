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
 */

/** Ce qu'on peut tirer du son d'une œuvre, et comment le dire. */
export const SIGNAUX = [
  { cle: 'niveau', etiquette: 'niveau (tout le spectre)' },
  { cle: 'basse', etiquette: 'basses (20–250 Hz)' },
  { cle: 'medium', etiquette: 'médiums (250–2 000 Hz)' },
  { cle: 'aigu', etiquette: 'aigus (2–8 kHz)' },
  { cle: 'crete', etiquette: 'crêtes (attaques, retombée lente)' }
];

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
  return {
    entree, oeuvre,
    signal: CLES_SIGNAUX.has(lien.signal) ? lien.signal : 'niveau',
    min: n(lien.min), max: n(lien.max),
    bas, haut,
    gain: Number.isFinite(lien.gain) && lien.gain > 0 ? lien.gain : 1
  };
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
    liste.push({ entree: String(ancien.entree), oeuvre: oeuvreId, signal: 'niveau',
      min: undefined, max: undefined, bas: 0, haut: 1,
      gain: Number.isFinite(ancien.gain) && ancien.gain > 0 ? ancien.gain : 1 });
  }
  return liste;
}

/**
 * La valeur d'une entrée pour un signal donné.
 * @param {object} lien  normalisé
 * @param {object} entree  { nom, type, defaut, min, max } (isf.js / dancefloor.js)
 * @param {number} signal  0..1 (peut dépasser : borné ici)
 * @param {*} repos  la valeur de repos (réglage de l'œuvre, sinon le défaut)
 * @returns {number|boolean|null}  null si l'entrée n'est pas liable
 */
export function resoudreLien(lien, entree, signal, repos) {
  if (!lien || !entree) return null;
  const s = courseDuSignal(lien, signal);
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
 * Le portail PORTÉ par une œuvre : dans la pièce, une entrée de `portals`
 * dont `via` est l'id de l'œuvre. Pas de porte à ce portail-là — l'œuvre
 * est la porte ; la carte et le test des passages, eux, voient un portail
 * comme les autres. Rend l'entrée, ou null.
 */
export function portailPorte(roomConfig, oeuvreId) {
  if (!oeuvreId) return null;
  return (roomConfig?.portals ?? []).find((p) => p && p.via === oeuvreId && p.to) ?? null;
}
