/**
 * Les réglages de réverbération, et les lieux qu'ils décrivent.
 *
 * À part de `Reverb.js`, qui charge la source du worklet (`?raw`) : ce qui
 * décide de quelque chose doit pouvoir s'éprouver au nœud.
 */

import { PREMIERES_DEFAUT, normaliserPremieres } from './premieres-reglages.js';

export const REVERB_DEFAUTS = {
  actif: true,
  taille: 0.4,    // A — l'ampleur du lieu
  duree: 0.5,     // B — combien la queue s'attarde
  sombre: 0.5,    // C — l'amortissement des aigus : pierre nue ou tenture
  envoi: 0,       // combien des œuvres y part. 0 = pièce sèche
  // Les PREMIÈRES réflexions (ClearCoat), qui partagent le même départ que
  // la queue : c'est la pièce entendue de PRÈS, là où une queue est masquée
  // par le direct. Voir premieres-worklet.js.
  premieres: PREMIERES_DEFAUT
};

/**
 * Quatre lieux tout faits, pour ne pas partir d'une page blanche.
 *
 * Ce sont des points de départ mesurés à l'oreille, pas des vérités : une
 * salle n'est pas ses dimensions, c'est ce qu'on y a mis. Un jardin à ciel
 * ouvert n'a presque pas de queue mais garde un peu d'air ; une
 * bibliothèque est petite ET sourde (les livres mangent tout) ; un
 * belvédère de cinquante mètres est immense et clair.
 */
export const LIEUX = {
  sec: { nom: 'Sec (aucune)', taille: 0.3, duree: 0.3, sombre: 0.5, envoi: 0, premieres: 0.2 },
  salle: { nom: 'Salle', taille: 0.4, duree: 0.5, sombre: 0.45, envoi: 0.18, premieres: 0.4 },
  bibliotheque: { nom: 'Bibliothèque', taille: 0.25, duree: 0.35, sombre: 0.8, envoi: 0.12, premieres: 0.3 },
  // un couloir, c'est PRESQUE QUE des premières réflexions : deux murs
  // proches et parallèles, et une queue qui n'a nulle part où s'installer
  couloir: { nom: 'Couloir', taille: 0.3, duree: 0.6, sombre: 0.3, envoi: 0.22, premieres: 0.6 },
  // à ciel ouvert, rien ne revient : le peu qu'on entend vient du sol
  jardin: { nom: 'Jardin (plein air)', taille: 0.6, duree: 0.25, sombre: 0.35, envoi: 0.08, premieres: 0.12 },
  belvedere: { nom: 'Belvédère', taille: 0.85, duree: 0.75, sombre: 0.25, envoi: 0.26, premieres: 0.45 }
};

/** Réglages relus et bornés — un JSON écrit à la main n'est pas de confiance. */
export function normaliserReverb(brut) {
  const source = typeof brut === 'string' ? LIEUX[brut] : brut;
  const c = { ...REVERB_DEFAUTS, ...(source ?? {}) };
  const borne = (v, min, max, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : repli;
  };
  return {
    actif: c.actif !== false,
    taille: borne(c.taille, 0, 1, REVERB_DEFAUTS.taille),
    duree: borne(c.duree, 0, 1, REVERB_DEFAUTS.duree),
    sombre: borne(c.sombre, 0, 1, REVERB_DEFAUTS.sombre),
    // Le départ est le seul réglage qui touche au NIVEAU : on le borne bas.
    // Au-delà de la moitié, une galerie où quinze sources envoient dans la
    // même pièce devient une soupe, et le limiteur passe son temps à tenir
    // une queue au lieu de tenir des œuvres.
    envoi: borne(c.envoi, 0, 0.5, REVERB_DEFAUTS.envoi),
    premieres: normaliserPremieres(c.premieres)
  };
}

/** Les réglages d'une pièce, sinon ceux de la galerie, sinon les défauts. */
export function reverbDePiece(configPiece, reglagesGalerie) {
  const declare = configPiece?.reverb ?? reglagesGalerie?.audio?.reverb ?? null;
  return normaliserReverb(declare);
}
