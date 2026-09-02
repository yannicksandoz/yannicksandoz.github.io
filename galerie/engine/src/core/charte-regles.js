/**
 * LES RÈGLES DE LA CHARTE — la part PURE, partagée entre trois mondes :
 *
 *   - `scripts/charte.mjs` (le rapport et `test-charte` au nœud) ;
 *   - l'ÉDITEUR (aimant d'accrochage, charte en direct, bouton Ranger) ;
 *   - `test-exposition.mjs` (les calculs de placement).
 *
 * UNE SEULE SOURCE DE VÉRITÉ : un chiffre de muséographie qui vivrait en
 * deux exemplaires divergerait au premier réglage — c'est arrivé à la
 * hauteur d'accrochage, écrite ici ET dans un commentaire de l'éditeur.
 * Ce module n'importe ni `fs`, ni `three`, ni le DOM : le nœud le résout
 * tel quel, le navigateur aussi.
 *
 * Repère : tout est LOCAL À LA PIÈCE (comme les positions des œuvres dans
 * les JSON) — c'est ce qui fait que l'aimant marche dans une pièce
 * basculée à la Escher : le mur nord reste le mur nord, quel que soit le
 * plan sur lequel le visiteur se tient.
 */

/* --------------------------------------------------------- les normes --- */

/** Accrochage muséal : centre à 1,50 m ; très grand format : bas à 0,90 m. */
export const ACCROCHAGE = { centre: 1.5, basMinimum: 0.9 };

/** Retrait d'un panneau par rapport au mur qui le porte (évite le z-fight). */
export const RETRAIT_MUR = 0.06;

/** Air minimal entre un corps solide et un seuil de portail (m). */
export const AIR_SEUIL = 0.7;

/** La tranche verticale où circule un visiteur (relative au sol). */
export const CORPS = { bas: 0.2, haut: 2.1 };

/** Le recul des galeristes : 1,5 diagonale d'espace libre devant l'œuvre. */
export const RECUL_FACTEUR = 1.5;

/** Une corniche s'écarte d'au moins ça d'une baie ou d'une apparition (m). */
export const GARDE_CORNICHE = 0.3;

/** Pas de grille proposés à la pose au sol (m). */
export const PAS_GRILLE = [0.25, 0.5, 1];

/**
 * Les quatre murs d'une coque, dans le REPÈRE DE LA PIÈCE : l'axe qui les
 * porte, le signe du côté, et le lacet (degrés) qui tourne un panneau face
 * à la salle — le même `LACET_MUR` que les primitives du moteur.
 */
export const MURS = {
  nord: { axe: 'z', signe: -1, lacet: 0 },
  sud: { axe: 'z', signe: 1, lacet: 180 },
  est: { axe: 'x', signe: 1, lacet: -90 },
  ouest: { axe: 'x', signe: -1, lacet: 90 }
};

/** Les règles que l'éditeur montre EN DIRECT — mêmes noms côté charte. */
export const REGLES_DIRECT = ['accrochage', 'recul', 'seuil'];

/* ------------------------------------------------------------ lectures --- */

/** Une œuvre MURALE : un panneau d'image ou de vidéo. */
export function estMurale(w) {
  return Boolean(w && (w.image || w.video));
}

/** Hauteur affichée d'un panneau (m), échelle comprise. */
export function hauteurMurale(w) {
  return ((w.size ?? [2, 2])[1] ?? 2) * ((w.scale ?? [1, 1, 1])[1] ?? 1);
}

/** Largeur affichée d'un panneau (m), échelle comprise. */
export function largeurMurale(w) {
  return ((w.size ?? [2, 2])[0] ?? 2) * ((w.scale ?? [1, 1, 1])[0] ?? 1);
}

/** Largeur/profondeur utiles d'une salle : la coque, à défaut le sol. */
export function dimensionsSalle(s) {
  if (s.shell && typeof s.shell === 'object') {
    return { w: s.shell.width ?? 26, d: s.shell.depth ?? 20 };
  }
  const taille = (typeof s.floor === 'object' ? s.floor?.size : null) ?? 40;
  return { w: taille, d: taille };
}

/**
 * La hauteur d'accrochage VISÉE pour un panneau de `hauteur` mètres :
 * le centre à 1,50 m — sauf si l'œuvre est si grande qu'elle traînerait
 * au sol : on garde alors son bas à 0,90 m.
 */
export function hauteurVisee(hauteur) {
  return Math.max(ACCROCHAGE.centre, ACCROCHAGE.basMinimum + hauteur / 2);
}

/* ------------------------------------------------------------- la pose --- */

/**
 * Pose un panneau À PLAT contre un mur de la coque : centré à la hauteur
 * d'accrochage, petit retrait, face à la salle. `long` : la coordonnée LE
 * LONG du mur (x pour nord/sud, z pour est/ouest), gardée telle quelle —
 * c'est l'aimant : on n'écrase que ce que le mur impose.
 */
export function poseSurMur(mur, salle, oeuvre, long = 0) {
  const m = MURS[mur];
  if (!m) return null;
  const { w, d } = dimensionsSalle(salle);
  const demi = (m.axe === 'x' ? w : d) / 2;
  const y = hauteurVisee(hauteurMurale(oeuvre));
  const perp = m.signe * (demi - RETRAIT_MUR);
  return {
    position: m.axe === 'x' ? [perp, y, long] : [long, y, perp],
    rotation: [0, m.lacet, 0]
  };
}

/**
 * Le mur le plus proche d'un point, et la distance qui l'en sépare — pour
 * décider si l'aimant mord. Rend { mur, distance, long } ; `long` est la
 * coordonnée le long de ce mur.
 */
export function murLePlusProche(salle, [x, , z]) {
  const { w, d } = dimensionsSalle(salle);
  const côtés = [
    { mur: 'nord', distance: Math.abs(z - -d / 2), long: x },
    { mur: 'sud', distance: Math.abs(z - d / 2), long: x },
    { mur: 'est', distance: Math.abs(x - w / 2), long: z },
    { mur: 'ouest', distance: Math.abs(x - -w / 2), long: z }
  ];
  return côtés.sort((a, b) => a.distance - b.distance)[0];
}

/**
 * Répartit `oeuvres` (des panneaux) sur un mur : espacement régulier,
 * hauteur d'accrochage, dans l'ordre donné. L'espacement se calcule sur
 * les LARGEURS réelles — deux grands formats ne se chevauchent pas parce
 * qu'un petit les sépare. Rend un tableau de { position, rotation },
 * ou null si le mur est trop court (on ne serre pas au chausse-pied).
 */
export function repartitionSurMur(mur, salle, oeuvres, { marge = 1, air = 0.6 } = {}) {
  const m = MURS[mur];
  if (!m || !oeuvres.length) return null;
  const { w, d } = dimensionsSalle(salle);
  const longueur = (m.axe === 'x' ? d : w) - 2 * marge;
  const largeurs = oeuvres.map((o) => largeurMurale(o));
  const occupe = largeurs.reduce((s, l) => s + l, 0)
    + air * (oeuvres.length - 1);
  if (occupe > longueur) return null;
  // l'espace restant se répartit ENTRE et AUTOUR des œuvres, également
  const jeu = (longueur - occupe) / (oeuvres.length + 1);
  const debut = -longueur / 2;
  let curseur = debut + jeu;
  return oeuvres.map((o, i) => {
    const centre = curseur + largeurs[i] / 2;
    curseur += largeurs[i] + air + jeu;
    // le long du mur, l'axe croît vers +x (nord/sud) ou +z (est/ouest) ;
    // vu de la salle, le mur sud et le mur ouest se lisent en miroir —
    // on garde l'ordre de lecture du VISITEUR qui fait face au mur
    const sens = (mur === 'sud' || mur === 'ouest') ? -1 : 1;
    return poseSurMur(mur, salle, o, sens * centre);
  });
}

/* ------------------------------------------------------- l'emprise --- */

/**
 * L'emprise RÉELLE d'un modèle voxel : les bornes de ses cellules pleines,
 * lues dans le RLE (`voxel.js` : longueur, valeur, longueur, valeur…, et
 * l'indice linéaire vaut x + dims[0]·(y + dims[1]·z)). En mètres, dans le
 * repère de l'objet — la grille est centrée en x/z, posée en y.
 */
export function occupationVoxel(m) {
  const dims = m.dims ?? [16, 16, 16];
  const cell = m.cell ?? 0.25;
  const total = dims[0] * dims[1] * dims[2];
  const rle = m.cells ?? [];
  let i = 0, vu = false;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k + 1 < rle.length && i < total; k += 2) {
    const run = rle[k], valeur = rle[k + 1];
    if (valeur) {
      for (let n = 0; n < run && i + n < total; n++) {
        const idx = i + n;
        const x = idx % dims[0];
        const y = Math.floor(idx / dims[0]) % dims[1];
        const z = Math.floor(idx / (dims[0] * dims[1]));
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
        vu = true;
      }
    }
    i += run;
  }
  if (!vu) return null;
  return {
    largeur: Math.max(x1 - x0 + 1, z1 - z0 + 1) * cell,
    largeurX: (x1 - x0 + 1) * cell, largeurZ: (z1 - z0 + 1) * cell,
    bas: y0 * cell, haut: (y1 + 1) * cell
  };
}

/**
 * EMPRISE AU SOL d'une œuvre : demi-largeur horizontale et hauteur.
 *
 * `ampleurOeuvre` rend une DIAGONALE — bonne pour l'angle apparent, muette
 * sur la place que l'objet prend par terre. Ici on veut les deux mesures
 * séparément : de quoi savoir si l'on passe à côté, et si l'objet est au
 * sol plutôt que suspendu ou peint à plat.
 */
export function empriseAuSol(w) {
  const s = w.scale ?? [1, 1, 1];
  const [sx, sy, sz] = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
  const h = Math.max(sx, sz);
  // `bas` et `haut` sont RELATIFS à la position : la plupart des formes se
  // centrent sur elle, un voxel repose dessus.
  // `demiX`/`demiZ` : l'emprise PAR AXE. Un rayon unique prend la plus
  // grande des deux, ce qui fait d'une volée de sept mètres de long un
  // disque de sept mètres de diamètre — et condamne des portails qu'elle
  // ne touche pas. Les règles qui visent juste ont besoin du rectangle.
  const centre = (largeur, hauteur) => ({
    rayon: (largeur * h) / 2, demiX: (largeur * sx) / 2, demiZ: (largeur * sz) / 2,
    bas: -(hauteur * sy) / 2, haut: (hauteur * sy) / 2
  });

  const m = w.model ?? {};
  // Une nappe d'EAU est horizontale : large au sol, sans épaisseur. Comptée
  // comme un volume, le bassin du jardin barrait trois lignes de force
  // qu'on longe en réalité sans même ralentir.
  if (m.shape === 'eau') {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    return { rayon: (1.6 * t * h) / 2, demiX: (1.6 * t * sx) / 2,
      demiZ: (1.6 * t * sz) / 2, bas: -0.05, haut: 0.05 };
  }
  // Un GALET est une dalle : large comme sa `size`, épaisse de quelques
  // centimètres (`epaisseur`). Comptée cubique, la margelle du bassin —
  // 7,4 m de large, 24 cm d'épais — barrait deux lignes de force qu'on
  // enjambe sans y penser.
  if (m.shape === 'galet') {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    const ep = Math.max(0.02, Number(m.epaisseur) || t * 0.1);
    return { rayon: (1.6 * t * h) / 2, demiX: (1.6 * t * sx) / 2,
      demiZ: (1.6 * t * sz) / 2, bas: -(ep * sy) / 2, haut: (ep * sy) / 2 };
  }
  if (Array.isArray(w.size) && w.size.length === 2) return centre(w.size[0], w.size[1]);
  if (Array.isArray(w.scanTaille) && w.scanTaille.length === 3) {
    const [x, y, z] = w.scanTaille;
    return centre(Math.max(x, z), y);
  }
  if (m.shape === 'monolith') return centre(1.1, m.height ?? 4);
  if (m.type === 'voxel') {
    // On lit les CELLULES PLEINES, pas la grille : une grille de 16³ à
    // 0,25 m fait quatre mètres de large, mais la sculpture du labo n'en
    // occupe qu'une poignée — comptée pleine, elle serrait une ligne
    // qu'elle laisse en fait entièrement libre.
    const occ = occupationVoxel(m);
    if (occ) {
      return { rayon: (occ.largeur * h) / 2,
        demiX: (occ.largeurX * sx) / 2, demiZ: (occ.largeurZ * sz) / 2,
        bas: occ.bas * sy, haut: occ.haut * sy };
    }
    const [dx, dy, dz] = m.dims ?? [16, 16, 16];
    const cell = m.cell ?? 0.25;
    return { rayon: (Math.max(dx, dz) * cell * h) / 2,
      demiX: (dx * cell * sx) / 2, demiZ: (dz * cell * sz) / 2,
      bas: 0, haut: dy * cell * sy };
  }
  if (m.shape) {
    const t = Number.isFinite(m.size) ? m.size : 1.5;
    const EMPRISES = {
      box: [1, 1], sphere: [1.2, 1.2], plane: [1.6, 1],
      cylinder: [1, 1.6], cone: [1.2, 1.6], torus: [1.64, 1.64],
      faisceau: [1.7, 6], lucioles: [1, 1]
    };
    const [l, ha] = EMPRISES[m.shape] ?? [1, 1];
    return centre(l * t, ha * t);
  }
  if (m.url && Number.isFinite(m.fit)) return centre(m.fit, m.fit);
  return centre(1.5, 1.5);
}

/* ------------------------------------------------------------ les écarts --- */

/** Écart d'accrochage d'un panneau : où il est, où la charte le vise. */
export function ecartAccrochage(w) {
  const y = (w.position ?? [0, 0, 0])[1];
  const hauteur = hauteurMurale(w);
  const vise = hauteurVisee(hauteur);
  return { id: w.id, y, hauteur, vise, ecart: y - vise };
}

/** Le recul disponible devant un panneau, contre le requis (1,5 diagonale). */
export function reculDe(w, salle) {
  const { w: lw, d: ld } = dimensionsSalle(salle);
  const [px, , pz] = w.position ?? [0, 0, 0];
  const ry = ((w.rotation ?? [0, 0, 0])[1] ?? 0) * (Math.PI / 180);
  const nx = Math.sin(ry), nz = Math.cos(ry);
  const borne = (p, n, demi) => (Math.abs(n) < 1e-4 ? Infinity
    : ((n > 0 ? demi : -demi) - p) / n);
  const libre = Math.min(borne(px, nx, lw / 2), borne(pz, nz, ld / 2));
  const diagonale = Math.hypot(largeurMurale(w), hauteurMurale(w));
  return { id: w.id, libre, diagonale,
    requis: RECUL_FACTEUR * diagonale,
    manque: RECUL_FACTEUR * diagonale - libre };
}

/**
 * Les seuils encombrés d'une salle : un corps solide à hauteur d'homme,
 * à moins d'AIR_SEUIL d'un portail. `emprise(w)` vient de la charte
 * (empriseAuSol) — passée en argument pour que ce module reste sans
 * dépendance.
 */
export function seuilsEncombres(salle, oeuvres, emprise, {
  luminaires = new Set(), serpentin = null
} = {}) {
  const solides = (salle.works ?? [])
    .map((id) => oeuvres.find((w) => w.id === id))
    .filter((w) => w && !luminaires.has(w.model?.shape)
      && w.model?.shape !== 'lucioles' && w.solid !== false);
  const rapport = [];
  for (const p of salle.portals ?? []) {
    const corps = echantillonsPortail(p, 'corps');
    const axe = echantillonsPortail(p, 'axe');
    const cadre = echantillonsPortail(p, 'cadre');
    for (const w of solides) {
      const ctx = { serpentin, cellules: null };
      // un voxel se lit dans ses cellules, sur trois colonnes ; une forme
      // pleine se lit dans sa boîte d'emprise, sur l'axe du portail avec
      // l'air autour (AIR_SEUIL) — trois colonnes ET la marge feraient
      // 1,3 m d'air exigé, et la couronne d'un arbre voisin bloquerait
      const voxel = w.model?.type === 'voxel' && Array.isArray(w.model.cells);
      const dedansCorps = (voxel ? corps : axe)
        .filter((q) => pointDansOeuvre(w, q, emprise, { ...ctx, marge: voxel ? 0 : AIR_SEUIL })).length;
      const dedansCadre = dedansCorps ? 0
        : cadre.filter((q) => pointDansOeuvre(w, q, emprise, ctx)).length;
      if (!dedansCorps && !dedansCadre) continue;
      rapport.push({
        portail: p.to ?? '?', objet: w.id, position: [...(p.position ?? [0, 0, 0])],
        // `corps` : un visiteur sur le seuil serait DANS l'objet (ou à moins
        // d'AIR_SEUIL d'une masse pleine) — bloquant. `cadre` : seul le cadre
        // du portail traverse la matière — gênant, pas bloquant.
        genre: dedansCorps ? 'corps' : 'cadre',
        touches: dedansCorps || dedansCadre
      });
    }
  }
  return rapport;
}

/* ---------------------------------------------- géométrie des seuils --- */

const DEG = Math.PI / 180;

/**
 * La matrice de rotation d'une œuvre ou d'un portail : Euler XYZ en degrés
 * (l'ordre de three), ou le seul `rotationY`. Rendue en lignes.
 */
export function matriceRotation(cfg) {
  const rot = Array.isArray(cfg?.rotation) ? cfg.rotation : [0, cfg?.rotationY ?? 0, 0];
  const a = (rot[0] ?? 0) * DEG, b = (rot[1] ?? 0) * DEG, c = (rot[2] ?? 0) * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const cc = Math.cos(c), sc = Math.sin(c);
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]
  ];
}

/** R · v — un vecteur du repère de l'objet vers le monde (sans translation). */
export function depuisLocal(R, v) {
  return [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
}

/** Rᵀ · v — un vecteur du monde vers le repère de l'objet. */
export function versLocal(R, v) {
  return [0, 1, 2].map((i) => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]);
}

/** Les cellules PLEINES d'un modèle voxel (RLE de voxel.js) : un Set d'indices. */
export function cellulesPleines(m) {
  const set = new Set();
  const rle = m?.cells ?? [];
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    if (rle[k + 1]) for (let n = 0; n < rle[k]; n++) set.add(i + n);
    i += rle[k];
  }
  return set;
}

/**
 * Un POINT du monde est-il dans la matière d'une œuvre ?
 *
 * Voxel : on ramène le point dans la grille (rotation complète, échelle,
 * serpentement défait par `serpentin(dims, cell)` si la loi est fournie)
 * et on lit la cellule — pleine ou non. C'est ce qui manquait : la règle
 * lisait une boîte axée sur le monde, aveugle à une volée tournée de 90°,
 * posée sur un mur, ou serpentée par le style fluide. Autres formes : la
 * boîte d'emprise, dans le repère de l'objet, élargie de `marge`.
 * `cellules` (Set) peut être fourni pour ne pas redécoder le RLE à chaque
 * point ; sinon il est décodé et mémorisé sur `ctx.cellules`.
 */
export function pointDansOeuvre(w, point, emprise, ctx = {}) {
  const s = w.scale ?? [1, 1, 1];
  const R = matriceRotation(w);
  const pos = w.position ?? [0, 0, 0];
  const l = versLocal(R, [point[0] - pos[0], point[1] - pos[1], point[2] - pos[2]])
    .map((v, i) => v / (s[i] || 1));
  const m = w.model ?? {};
  if (m.type === 'voxel' && Array.isArray(m.cells)) {
    const dims = m.dims ?? [16, 16, 16];
    const cell = m.cell ?? 0.25;
    const loi = ctx.serpentin ? ctx.serpentin(dims, cell) : null;
    const q = loi ? deserpenterLocal(loi, dims, cell, l) : l;
    const x = Math.floor(q[0] / cell + dims[0] / 2);
    const y = Math.floor(q[1] / cell);
    const z = Math.floor(q[2] / cell + dims[2] / 2);
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return false;
    if (!ctx.cellules) ctx.cellules = new Map();
    let set = ctx.cellules.get(w.id);
    if (!set) { set = cellulesPleines(m); ctx.cellules.set(w.id, set); }
    return set.has(x + dims[0] * (y + dims[1] * z));
  }
  const e = emprise(w);
  const marge = ctx.marge ?? 0;
  // l'emprise est donnée dans le monde pour un objet droit : demi-largeurs
  // par axe et hauteurs relatives à la position — on la lit ici dans le
  // repère local, l'échelle déjà comprise dans `emprise`
  const dx = e.demiX / (s[0] || 1), dz = e.demiZ / (s[2] || 1);
  const bas = e.bas / (s[1] || 1), haut = e.haut / (s[1] || 1);
  // la marge (l'air autour du seuil) est HORIZONTALE — une nappe d'eau ou
  // une dalle à ras du sol ne bloque pas un corps qui la surplombe — et se
  // lit EN MÈTRES DU MONDE : `l` est déjà divisé par l'échelle, la marge
  // l'est donc aussi (sinon 0,70 m d'air devenaient 1,80 m autour d'une
  // couronne d'arbre à l'échelle 2,6)
  return Math.abs(l[0]) <= dx + marge / (s[0] || 1)
    && Math.abs(l[2]) <= dz + marge / (s[2] || 1)
    && l[1] >= bas && l[1] <= haut;
}

/** L'inverse du serpentement, sur un point du repère de l'objet (voir serpentin.js). */
function deserpenterLocal(loi, dims, cell, local) {
  const l = [...local];
  if (loi.axe === 2) {
    const t = (l[2] / cell + dims[2] / 2) / dims[2];
    l[0] = (l[0] - loi.decalage(t)) / loi.gonflement(t);
  } else {
    const t = (l[0] / cell + dims[0] / 2) / dims[0];
    l[2] = (l[2] - loi.decalage(t)) / loi.gonflement(t);
  }
  return l;
}

/**
 * Les points à tester autour d'un portail, dans SON repère (un portail
 * posé sur un mur a son « haut » le long du mur) : `corps` — le corps d'un
 * visiteur sur le seuil, trois colonnes (−0,6 · 0 · +0,6 m) de CORPS.bas à
 * CORPS.haut ; `cadre` — le cadre du portail, 2,4 m de large sur 3 m de
 * haut, au pas de 30 cm, au-dessus de 30 cm (à zéro, on toucherait la dalle
 * sur laquelle le portail est légitimement posé).
 */
export function echantillonsPortail(p, quoi = 'corps') {
  const R = matriceRotation(p);
  const P = p.position ?? [0, 0, 0];
  const haut = depuisLocal(R, [0, 1, 0]);
  const droite = depuisLocal(R, [1, 0, 0]);
  const points = [];
  const hauteurs = [], largeurs = [];
  if (quoi === 'corps' || quoi === 'axe') {
    for (let h = CORPS.bas; h <= CORPS.haut + 1e-6; h += 0.5) hauteurs.push(h);
    if (quoi === 'corps') largeurs.push(-0.6, 0, 0.6);
    else largeurs.push(0);            // l'axe seul : la colonne du milieu
  } else {
    for (let h = 0.3; h <= 3.0 + 1e-6; h += 0.3) hauteurs.push(h);
    for (let d = -1.2; d <= 1.2 + 1e-6; d += 0.3) largeurs.push(d);
  }
  for (const h of hauteurs) {
    for (const d of largeurs) {
      points.push([0, 1, 2].map((i) => P[i] + haut[i] * h + droite[i] * d));
    }
  }
  return points;
}

/**
 * LES ÉCARTS D'UNE SALLE, tels que l'éditeur les montre en direct — chaque
 * entrée nomme la règle, l'objet, le texte, et si le bouton « Ranger »
 * sait la corriger (avec quoi).
 *
 * `emprise` : empriseAuSol de la charte (injectée) ; `tolerance` en mètres
 * sur l'accrochage — un panneau à 1,52 m n'est pas un écart.
 */
export function ecartsSalle(salle, oeuvres, emprise, {
  tolerance = 0.05, luminaires = new Set(), serpentin = null
} = {}) {
  const ecarts = [];
  const siennes = (salle.works ?? [])
    .map((id) => oeuvres.find((w) => w.id === id))
    .filter(Boolean);

  for (const w of siennes.filter(estMurale)) {
    const a = ecartAccrochage(w);
    if (Math.abs(a.ecart) > tolerance) {
      ecarts.push({
        regle: 'accrochage', objet: w.id,
        texte: `« ${w.title ?? w.id} » est accroché à ${a.y.toFixed(2)} m — la charte vise ${a.vise.toFixed(2)} m`,
        correction: { champ: 'y', valeur: +a.vise.toFixed(3) }
      });
    }
    const r = reculDe(w, salle);
    if (r.manque > 0.05 && Number.isFinite(r.manque)) {
      ecarts.push({
        regle: 'recul', objet: w.id,
        texte: `« ${w.title ?? w.id} » n'a que ${r.libre.toFixed(1)} m de recul — il en faut ${r.requis.toFixed(1)} (1,5 diagonale)`
        // pas de correction automatique : reculer une œuvre est un choix
      });
    }
  }

  for (const s of seuilsEncombres(salle, oeuvres, emprise, { luminaires, serpentin })) {
    ecarts.push({
      regle: 'seuil', objet: s.objet,
      texte: s.genre === 'corps'
        ? `« ${s.objet} » est DANS le seuil du portail vers ${s.portail} : un visiteur y serait pris dans la matière (${s.touches} point(s) du corps, air minimum ${AIR_SEUIL} m)`
        : `« ${s.objet} » traverse le cadre du portail vers ${s.portail} (${s.touches} point(s) du cadre) — gênant, pas bloquant`
      // pas de correction automatique : le bon côté du dégagement est un choix
    });
  }
  return ecarts;
}
