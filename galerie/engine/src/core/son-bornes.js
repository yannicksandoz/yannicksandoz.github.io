/**
 * LES BORNES D'UNE PISTE — quelle PART du fichier est l'œuvre.
 *
 * Un enregistrement porte souvent son silence d'amorce et sa queue morte.
 * Bouclé tel quel, on réécoute ce vide à chaque tour : le son « arrive en
 * retard » à chaque fois qu'on entre dans la salle. Deux champs le disent,
 * dans le JSON de la piste :
 *
 *   "stems": [{ "file": "…", "debut": "0:04.5", "fin": "5:42.5" }]
 *
 * Écrits comme sur un lecteur — `12`, `"12.5"`, `"0:12"`, `"1:23.5"`,
 * `"1:02:03"` — et TOLÉRANTS : une borne illisible, à l'envers, ou au-delà
 * de la fin du fichier est simplement ignorée. Jamais de silence par faute
 * de frappe : au pire, le son se lit en entier comme avant.
 *
 * Module à part, sans Web Audio ni Vite : la suite de tests le conduit au
 * nœud, comme reverb-reglages.js ou air-reglages.js.
 */

/** Un instant écrit à la main → des secondes, ou null si ça ne dit rien. */
export function secondes(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  // « s », « m:ss », « h:mm:ss », avec décimales sur le dernier champ —
  // trois champs au plus : au-delà, ce n'est plus une durée mais une faute
  if (!/^\d+(:[0-5]?\d){0,2}(\.\d+)?$/.test(t)) return null;
  let total = 0;
  for (const part of t.split(':')) total = total * 60 + parseFloat(part);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

/**
 * Les bornes effectives d'une piste, une fois confrontées au fichier réel.
 * → { debut, fin, borne } en secondes ; `borne` dit si la boucle doit être
 *   restreinte (loopStart/loopEnd) plutôt que de courir sur tout le buffer.
 */
export function bornesLecture(cfg, duree) {
  const total = Number.isFinite(duree) && duree > 0 ? duree : 0;
  let debut = secondes(cfg?.debut) ?? 0;
  let fin = secondes(cfg?.fin);
  if (!total) return { debut: 0, fin: 0, borne: false };
  if (debut >= total) debut = 0;                        // hors du fichier
  if (fin !== null) fin = Math.min(fin, total);
  if (fin !== null && fin <= debut + 0.01) fin = null;   // à l'envers, ou nulle
  return { debut, fin: fin ?? total, borne: debut > 0 || fin !== null };
}

/**
 * Démarre une source bouclée en respectant ses bornes. UN SEUL endroit sait
 * comment on lance un son dans cette galerie : les pistes d'œuvre
 * (Artwork.setStemsActive) et les ambiances de pièce (RoomManager) passent
 * toutes les deux par ici — sans quoi une seule des deux aurait le trim.
 */
export function lancerBoucle(src, cfg, quand) {
  const b = bornesLecture(cfg, src.buffer?.duration);
  src.loop = true;
  if (b.borne) { src.loopStart = b.debut; src.loopEnd = b.fin; }
  src.start(quand, b.debut);
  return b;
}
