/**
 * LE BUDGET D'UNE SALLE — « cette salle tient-elle sur un téléphone ? »
 *
 * La charte dit si un placement est juste. Elle ne disait pas si la salle
 * PASSE : combien de mégaoctets le visiteur télécharge pour y être, combien
 * de mémoire son téléphone y consacre au son décodé, combien de pistes
 * jouent en même temps au pire endroit. Trois jauges, mêmes règles pour
 * l'éditeur (pendant qu'on compose) et pour le garde-fou du build
 * (check-visitor-build.mjs) : un seul fichier de vérité, pur, éprouvé par
 * test-budget-salle.
 *
 * Le PÉRIMÈTRE est celui du chargeur : la pièce courante et ses voisines
 * directes par portail (RoomManager). Quand on est dans une salle, tout
 * cela est en mémoire — et c'est cela qu'on pèse.
 *
 * Les trois règles, pour un téléphone (profil mobile de Quality.js) :
 *   1. TRANSFERT : ce que le visiteur télécharge pour la salle et ses
 *      voisines — images, vidéos, modèles, scans, sons — au plus 25 Mo.
 *      Une piste par fragments ne compte que ce qu'elle tient à la fois
 *      (RESIDENT_S secondes), pas l'heure entière qu'elle pourrait jouer.
 *   2. PCM : le son DÉCODÉ en mémoire, 48 kHz stéréo flottant, soit
 *      384 000 octets par seconde quel que soit le fichier ; au plus
 *      120 Mo. Un fichier compressé n'y change rien : ce qui compte est la
 *      durée, et c'est pour cela que les longues pistes se fragmentent.
 *   3. VOIX : les œuvres audibles au PIRE point de la salle — un
 *      quadrillage au mètre du sol, une œuvre audible sous le plus grand
 *      rayon de ses pistes, UNE voix par œuvre (ses pistes partagent leur
 *      voie, voir Spatialisation) — au plus 6 (maxStems du profil mobile).
 *      Au-delà, le budget de voix coupe les plus lointaines : la salle
 *      n'est plus ce qu'on a composé.
 *
 * `mesures` dit ce qu'on sait des fichiers : `octets.get(chemin)` et
 * `durees.get(chemin)` (secondes). Ce qu'on ne sait pas est dit INCONNU
 * dans le rapport, jamais compté à zéro en silence — une jauge qui
 * rassure à tort vaut moins que pas de jauge.
 */

/** Les plafonds d'un téléphone. */
export const BUDGET = Object.freeze({
  transfertMo: 25,
  pcmMo: 120,
  stems: 6
});

/** Octets d'une seconde de son décodé : 48 000 × 2 canaux × 4 octets. */
export const OCTETS_PAR_SECONDE = 48000 * 2 * 4;
/** Ce qu'un lecteur de fragments tient au plus à la fois (fragments.js). */
export const RESIDENT_S = 30;
/** Rayon d'audibilité d'une piste qui n'en déclare pas (Artwork). */
export const RAYON_DEFAUT = 12;
/** Le sol se quadrille au mètre. */
export const PAS_GRILLE = 1;

const MO = 1048576;

/** Les voisines directes d'une salle : ses portails, vers des salles qui existent. */
export function voisinesDe(salle, rooms) {
  const ids = new Set();
  for (const p of salle?.portals ?? []) {
    if (p?.to && p.to !== salle.id && rooms.some((r) => r.id === p.to)) ids.add(p.to);
  }
  return [...ids];
}

/**
 * Les FICHIERS qu'une salle fait charger, chacun dit une fois :
 * { chemin, genre: 'image'|'video'|'modele'|'scan'|'son'|'fragments',
 *   fragments: manifeste|null, oeuvre }.
 * Une piste par fragments est repérée par son manifeste ; c'est la mesure
 * qui dira ce que pèsent ses segments et combien de temps elle dure.
 */
export function fichiersDe(salle, works) {
  const vus = new Map();
  const noter = (chemin, genre, oeuvre, extra = {}) => {
    if (!chemin || typeof chemin !== 'string' || vus.has(chemin)) return;
    vus.set(chemin, { chemin, genre, oeuvre, ...extra });
  };
  const parId = new Map((works ?? []).map((w) => [w?.id, w]));
  for (const ref of salle?.works ?? []) {
    const w = typeof ref === 'string' ? parId.get(ref) : ref;
    if (!w) continue;
    noter(w.image, 'image', w.id);
    noter(w.video, 'video', w.id);
    noter(w.scan, 'scan', w.id);
    if (w.model && typeof w.model === 'object') noter(w.model.url, 'modele', w.id);
    for (const s of w.stems ?? []) noterPiste(s, w.id);
  }
  for (const a of salle?.ambience ?? []) noterPiste(a, `ambiance:${salle.id}`);
  function noterPiste(s, oeuvre) {
    if (!s || typeof s !== 'object') return;
    if (s.fragments) { noter(s.fragments, 'fragments', oeuvre); return; }
    // les formats encodés remplacent le fichier d'origine à la publication :
    // on pèse le premier format déclaré, c'est ce qu'un téléphone reçoit
    const formats = s.formats && typeof s.formats === 'object' ? Object.values(s.formats) : [];
    noter(formats[0] ?? s.file, 'son', oeuvre);
  }
  return [...vus.values()];
}

/**
 * Le PIRE POINT du sol : le nombre maximal d'ŒUVRES audibles depuis un
 * même mètre carré, et où. Les œuvres de la salle seule (le budget de
 * voix du moteur ne joue que la pièce courante). Une œuvre est audible
 * sous le plus grand rayon de ses pistes (`radius`, sinon RAYON_DEFAUT),
 * en distance horizontale ; elle coûte UNE voix, quel que soit son nombre
 * de pistes.
 */
export function pirePoint(salle, works, { pas = PAS_GRILLE } = {}) {
  const parId = new Map((works ?? []).map((w) => [w?.id, w]));
  const sources = [];
  for (const ref of salle?.works ?? []) {
    const w = typeof ref === 'string' ? parId.get(ref) : ref;
    if (!w?.stems?.length) continue;
    const [x = 0, , z = 0] = w.position ?? [0, 0, 0];
    let r = 0;
    for (const s of w.stems) r = Math.max(r, Number(s?.radius) > 0 ? Number(s.radius) : RAYON_DEFAUT);
    sources.push({ x, z, r });
  }
  if (!sources.length) return { pire: 0, point: null };
  const { w, d } = dimensions(salle);
  let pire = 0; let point = null;
  for (let x = -w / 2; x <= w / 2 + 1e-9; x += pas) {
    for (let z = -d / 2; z <= d / 2 + 1e-9; z += pas) {
      let n = 0;
      for (const s of sources) if (Math.hypot(s.x - x, s.z - z) < s.r) n++;
      if (n > pire) { pire = n; point = [Math.round(x * 100) / 100, Math.round(z * 100) / 100]; }
    }
  }
  return { pire, point };
}

/** Largeur/profondeur du sol : la coque, à défaut le sol (comme la charte). */
function dimensions(s) {
  if (s?.shell && typeof s.shell === 'object') return { w: s.shell.width ?? 26, d: s.shell.depth ?? 20 };
  const taille = (typeof s?.floor === 'object' ? s.floor?.size : null) ?? 40;
  return { w: taille, d: taille };
}

/**
 * LE BUDGET d'une salle. `mesures` : { octets: Map, durees: Map } par
 * chemin ; pour un manifeste de fragments, `octets` est le poids de TOUS
 * ses segments (dans le format choisi) et `durees` la durée de la piste.
 * Rend { salle, voisines, transfert, pcm, stems, ecarts } — les écarts
 * sont ce qui dépasse, dans les mots de l'auteur.
 */
export function budgetSalle(salle, { rooms = [], works = [], mesures = {}, budget = BUDGET } = {}) {
  const octetsDe = (c) => mesures.octets?.get?.(c);
  const dureeDe = (c) => mesures.durees?.get?.(c);
  const voisines = voisinesDe(salle, rooms);
  const perimetre = [salle, ...voisines.map((id) => rooms.find((r) => r.id === id))].filter(Boolean);

  // — transfert : chaque fichier une fois, même partagé entre deux salles
  const parChemin = new Map();
  for (const s of perimetre) {
    for (const f of fichiersDe(s, works)) if (!parChemin.has(f.chemin)) parChemin.set(f.chemin, { ...f, salle: s.id });
  }
  const parts = []; const inconnus = [];
  let transfert = 0; let pcm = 0; let pistes = 0; const dureesInconnues = [];
  for (const f of parChemin.values()) {
    const o = octetsDe(f.chemin);
    const duree = dureeDe(f.chemin);
    if (f.genre === 'fragments') {
      // ce qu'un lecteur tient à la fois : RESIDENT_S secondes, pas la piste
      const part = Number.isFinite(duree) && duree > 0 ? Math.min(1, RESIDENT_S / duree) : 1;
      if (Number.isFinite(o)) { transfert += o * part; parts.push({ ...f, octets: o * part }); } else inconnus.push(f.chemin);
      pistes++;
      if (Number.isFinite(duree)) pcm += Math.min(duree, RESIDENT_S) * OCTETS_PAR_SECONDE; else dureesInconnues.push(f.chemin);
      continue;
    }
    if (Number.isFinite(o)) { transfert += o; parts.push({ ...f, octets: o }); } else inconnus.push(f.chemin);
    if (f.genre === 'son') {
      pistes++;
      if (Number.isFinite(duree)) pcm += duree * OCTETS_PAR_SECONDE; else dureesInconnues.push(f.chemin);
    }
  }
  parts.sort((a, b) => b.octets - a.octets);

  const { pire, point } = pirePoint(salle, works);
  const ecarts = [];
  if (transfert > budget.transfertMo * MO) {
    ecarts.push({ regle: 'transfert', texte: `${enMo(transfert)} Mo à télécharger pour cette salle et ses voisines, plus que les ${budget.transfertMo} Mo d'un téléphone` });
  }
  if (pcm > budget.pcmMo * MO) {
    ecarts.push({ regle: 'pcm', texte: `${enMo(pcm)} Mo de son décodé en mémoire, plus que les ${budget.pcmMo} Mo d'un téléphone — fragmenter les longues pistes` });
  }
  if (pire > budget.stems) {
    ecarts.push({ regle: 'stems', texte: `${pire} œuvres audibles à la fois en (${point.join(', ')}), plus que les ${budget.stems} voix d'un téléphone — le moteur en coupera` });
  }
  return {
    salle: salle?.id, voisines,
    transfert: { octets: transfert, budget: budget.transfertMo * MO, parts, inconnus },
    pcm: { octets: pcm, budget: budget.pcmMo * MO, pistes, inconnus: dureesInconnues },
    stems: { pire, point, budget: budget.stems },
    ecarts
  };
}

/** Tous les budgets, une salle après l'autre. */
export function budgetsGalerie(rooms, works, mesures, budget = BUDGET) {
  return (rooms ?? []).map((s) => budgetSalle(s, { rooms, works, mesures, budget }));
}

export const enMo = (o) => (o / MO).toFixed(o < MO ? 2 : 1);

/**
 * La DURÉE d'un WAV sans le décoder : au format PCM 16 bits, on lit
 * fréquence, canaux et profondeur dans l'en-tête ; sans en-tête (on n'a
 * que le poids), on suppose 44,1 kHz stéréo 16 bits. Sert au garde-fou du
 * build, qui n'a pas de décodeur.
 */
export function dureeWav(octets, entete = null) {
  if (entete && entete.length >= 36) {
    const dv = new DataView(entete.buffer, entete.byteOffset, entete.byteLength);
    const canaux = dv.getUint16(22, true), hz = dv.getUint32(24, true), bits = dv.getUint16(34, true);
    const parSeconde = hz * canaux * (bits / 8);
    if (parSeconde > 0) return Math.max(0, octets - 44) / parSeconde;
  }
  return Math.max(0, octets - 44) / (44100 * 2 * 2);
}

/** Le rapport lisible, une ligne par salle, pour la console. */
export function texteBudgets(budgets, budget = BUDGET) {
  const lignes = [`budget par salle (téléphone : ${budget.transfertMo} Mo, ${budget.pcmMo} Mo de PCM, ${budget.stems} voix) :`];
  for (const b of budgets) {
    const drapeaux = b.ecarts.map((e) => e.regle).join(',');
    lignes.push(`   ${(b.salle ?? '?').padEnd(14)} ${enMo(b.transfert.octets).padStart(6)} Mo`
      + `  PCM ${enMo(b.pcm.octets).padStart(6)} Mo (${b.pcm.pistes} piste${b.pcm.pistes > 1 ? 's' : ''})`
      + `  pire point ${String(b.stems.pire).padStart(2)} voix`
      + `  voisines ${b.voisines.length}`
      + (b.transfert.inconnus.length || b.pcm.inconnus.length ? `  (${b.transfert.inconnus.length + b.pcm.inconnus.length} mesure(s) manquante(s))` : '')
      + (drapeaux ? `  ✗ ${drapeaux}` : ''));
  }
  return lignes.join('\n');
}
