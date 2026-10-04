/**
 * LA COURBE DES MURS — réglée par espace, en direct (beta.11).
 *
 * Jusqu'ici un mur ne se cintrait qu'avec le style « fluide » de toute la
 * galerie, au prochain chargement, selon une loi figée (style.loiParoi).
 * Un espace peut maintenant porter sa propre courbe dans sa coque :
 *
 *   "shell": { …, "courbe": {
 *       "profondeur": 0.6,          // mètres : de combien le mur s'écarte
 *       "ondes": 1,                 // 1 = une seule grande courbe ; n = n bosses alternées
 *       "sens": "creuse",           // "creuse" : vers l'extérieur ; "bombe" : vers l'intérieur
 *       "profil": "droit",          // "droit" : le mur entier suit ; "voile" : pied droit, haut cintré
 *       "couronne": { "hauteur": 1.2, "ondes": 3 },   // le haut ondule (mur sans plafond)
 *       "murs": {                   // mur par mur : ce qui est écrit remplace l'espace
 *         "nord": { "profondeur": 1.5, "points": [
 *           { "t": 0.3, "d": 1.2, "avant": [-0.1, 0], "apres": [0.1, 0.4] } ] } } } }
 *
 * Deux façons de courber un mur :
 *   • PARAMÉTRIQUE — profondeur × sin(π · ondes · t), extrémités à zéro ;
 *   • VECTORIELLE — des ANCRES le long du mur (t de 0 à 1, d en mètres,
 *     positif vers l'extérieur), chacune avec deux POIGNÉES de tangente,
 *     comme un chemin de GIMP. Les extrémités du mur sont des ancres
 *     implicites à zéro : les angles restent jointifs. Les poignées sont
 *     bornées pour que la courbe avance toujours le long du mur (une
 *     courbe qui reviendrait sur ses pas n'a pas de sens pour un mur).
 *
 * Sans `courbe`, rien ne change : le style fluide garde sa loi d'origine.
 *
 * Tout ici est pur — aucun three, aucun DOM : la loi que le moteur pose
 * sur la géométrie, celle que les corniches suivent et celle que les
 * poignées de l'éditeur dessinent sont la même. Testé au nœud
 * (scripts/test-courbe-murs.mjs).
 */

export const MURS = ['nord', 'sud', 'est', 'ouest'];
export const COURBE_DEFAUT = Object.freeze({ profondeur: 0.6, ondes: 1, sens: 'creuse', profil: 'droit', couronne: null });
export const COURONNE_DEFAUT = Object.freeze({ hauteur: 1.2, ondes: 3 });
export const BORNES_COURBE = Object.freeze({ profondeur: 6, ondes: 12, couronne: 4, couronneOndes: 12, points: 16 });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const arrondi = (v, p = 1000) => Math.round(v * p) / p;
const nombre = (v, repli) => { const n = Number(v); return Number.isFinite(n) ? n : repli; };

/* ------------------------------------------------------------ réglages --- */

function normaliserCouronne(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    hauteur: arrondi(clamp(nombre(c.hauteur, COURONNE_DEFAUT.hauteur), 0, BORNES_COURBE.couronne)),
    ondes: Math.round(clamp(nombre(c.ondes, COURONNE_DEFAUT.ondes), 1, BORNES_COURBE.couronneOndes))
  };
}

/**
 * Les ancres d'une courbe vectorielle, triées et bornées : t dans ]0, 1[,
 * d dans ±profondeur max, poignées qui ne dépassent jamais l'ancre voisine
 * (la courbe avance toujours le long du mur). Poignée absente : lisse,
 * horizontale, au tiers de l'intervalle.
 */
export function normaliserPoints(points) {
  if (!Array.isArray(points)) return null;
  const P = BORNES_COURBE.profondeur;
  const ancres = points
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({ t: clamp(nombre(p.t, NaN), 0.001, 0.999), d: clamp(nombre(p.d, 0), -P, P), avant: p.avant, apres: p.apres }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
    .slice(0, BORNES_COURBE.points);
  // deux ancres au même t : la seconde cède
  const uniques = ancres.filter((p, i) => i === 0 || p.t - ancres[i - 1].t > 0.002);
  return uniques.map((p, i) => {
    const tPrec = i === 0 ? 0 : uniques[i - 1].t;
    const tSuiv = i === uniques.length - 1 ? 1 : uniques[i + 1].t;
    const poignee = (h, dtMin, dtMax, defaut) => {
      const dt = Array.isArray(h) ? nombre(h[0], defaut) : defaut;
      const dd = Array.isArray(h) ? nombre(h[1], 0) : 0;
      return [arrondi(clamp(dt, dtMin, dtMax), 10000), arrondi(clamp(dd, -2 * P, 2 * P))];
    };
    return {
      t: arrondi(p.t, 10000), d: arrondi(p.d),
      avant: poignee(p.avant, -(p.t - tPrec), 0, -(p.t - tPrec) / 3),
      apres: poignee(p.apres, 0, tSuiv - p.t, (tSuiv - p.t) / 3)
    };
  });
}

/** Un réglage de courbe (de l'espace ou d'un mur) : seuls les champs écrits sont gardés pour un mur. */
function normaliserReglage(brut, { partiel = false } = {}) {
  const r = {};
  const a = brut && typeof brut === 'object' ? brut : {};
  const pose = (cle, valeur) => { if (!partiel || a[cle] !== undefined) r[cle] = valeur; };
  pose('profondeur', arrondi(clamp(nombre(a.profondeur, COURBE_DEFAUT.profondeur), 0, BORNES_COURBE.profondeur)));
  pose('ondes', Math.round(clamp(nombre(a.ondes, COURBE_DEFAUT.ondes), 1, BORNES_COURBE.ondes)));
  pose('sens', a.sens === 'bombe' ? 'bombe' : 'creuse');
  pose('profil', a.profil === 'voile' ? 'voile' : 'droit');
  if (!partiel || a.couronne !== undefined) r.couronne = a.couronne === false ? null : normaliserCouronne(a.couronne);
  if (a.points !== undefined) {
    const pts = normaliserPoints(a.points);
    if (pts && pts.length) r.points = pts;
  }
  return r;
}

/**
 * La courbe d'une coque, complète et bornée — ou null si la coque n'en
 * porte pas (`courbe` absent, false, ou pas un objet).
 */
export function normaliserCourbe(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const base = normaliserReglage(brut);
  const murs = {};
  for (const m of MURS) {
    const r = brut.murs?.[m];
    if (r && typeof r === 'object') {
      const n = normaliserReglage(r, { partiel: true });
      if (Object.keys(n).length) murs[m] = n;
    }
  }
  if (Object.keys(murs).length) base.murs = murs;
  return base;
}

/** Le réglage effectif d'un mur : celui de l'espace, remplacé par ce que le mur écrit. */
export function courbeDuMur(courbe, mur) {
  const c = normaliserCourbe(courbe);
  if (!c) return null;
  const { murs, ...base } = c;
  const propre = murs?.[mur] ?? {};
  const r = { ...base, ...propre };
  if (!propre.points) delete r.points;
  return r;
}

/* ---------------------------------------------------------------- lois --- */

/** 0 dans [a, b], 1 au-delà de la marge, fondu C¹ entre les deux (les baies restent planes). */
function masqueZone(x, a, b, marge = 0.7) {
  if (x >= a && x <= b) return 0;
  const d = x < a ? a - x : x - b;
  if (d >= marge) return 1;
  const u = d / marge;
  return u * u * (3 - 2 * u);
}

/** Point d'une cubique de Bézier, une coordonnée. */
const bezier = (p0, p1, p2, p3, s) => {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
};

/**
 * Le PROFIL EN PLAN d'une courbe vectorielle : la polyligne (t, d) qui
 * passe par les extrémités du mur et chaque ancre, en cubiques de Bézier
 * (ancre, poignée après, poignée avant de la suivante, ancre suivante).
 */
export function profilVectoriel(points, pas = 24) {
  const ancres = [{ t: 0, d: 0, avant: [0, 0], apres: null }, ...(normaliserPoints(points) ?? []), { t: 1, d: 0, avant: null, apres: [0, 0] }];
  // poignées des extrémités : lisses, au tiers, à plat (les angles restent droits)
  ancres[0].apres = [(ancres[1].t - 0) / 3, 0];
  ancres[ancres.length - 1].avant = [-(1 - ancres[ancres.length - 2].t) / 3, 0];
  const out = [[0, 0]];
  for (let i = 0; i < ancres.length - 1; i++) {
    const a = ancres[i], b = ancres[i + 1];
    const c1 = [a.t + a.apres[0], a.d + a.apres[1]];
    const c2 = [b.t + b.avant[0], b.d + b.avant[1]];
    for (let k = 1; k <= pas; k++) {
      const s = k / pas;
      out.push([bezier(a.t, c1[0], c2[0], b.t, s), bezier(a.d, c1[1], c2[1], b.d, s)]);
    }
  }
  // les poignées bornées gardent t croissant ; on le garantit quand même
  for (let i = 1; i < out.length; i++) if (out[i][0] < out[i - 1][0]) out[i][0] = out[i - 1][0];
  return out;
}

/** d(t) lu sur une polyligne (t croissant), par interpolation linéaire. */
function lireProfil(profil, t) {
  if (t <= 0 || t >= 1) return 0;
  let lo = 0, hi = profil.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profil[mid][0] <= t) lo = mid; else hi = mid;
  }
  const [t0, d0] = profil[lo], [t1, d1] = profil[hi];
  return t1 > t0 ? d0 + (d1 - d0) * (t - t0) / (t1 - t0) : d0;
}

/**
 * LA LOI DU VOILE d'un mur réglé : (x, y) → flèche SIGNÉE en mètres,
 * positive vers l'extérieur de l'espace, dans le repère du mur (x le long,
 * centré ; y la hauteur). Même contrat que style.loiParoi, le signe en
 * plus : `bombe` rentre dans l'espace.
 */
export function loiVoileReglee({ length, height, sink = 0, zones = [], plafonne = false, reglage }) {
  const r = reglage ?? COURBE_DEFAUT;
  const signe = r.sens === 'bombe' ? -1 : 1;
  const profilV = r.profil === 'voile'
    ? (yn) => (plafonne ? Math.sin(Math.PI * yn) : Math.pow(yn, 1.5))
    : () => 1;
  let enPlan;
  if (r.points?.length) {
    const profil = profilVectoriel(r.points);
    enPlan = (t) => lireProfil(profil, t);              // les ancres portent leur propre signe
  } else {
    const n = Math.max(1, Math.round(r.ondes ?? 1));
    const P = r.profondeur ?? 0;
    enPlan = (t) => signe * P * Math.sin(Math.PI * n * t);
  }
  return (x, y) => {
    const t = clamp((x + length / 2) / length, 0, 1);
    const yn = clamp((y + sink) / (height + sink), 0, 1);
    let f = enPlan(t) * profilV(yn);
    for (const [za, zb] of zones) f *= masqueZone(x, za, zb);
    return f;
  };
}

/**
 * LA LOI DU COURONNEMENT réglée : x → de combien le sommet DESCEND à cet
 * endroit (0 aux extrémités, jamais négatif : le sommet ne dépasse pas la
 * hauteur nominale, où les angles voisins l'attendent). Même forme que
 * style.loiCouronne — une porteuse de `ondes` périodes et une harmonique —
 * avec la hauteur et le nombre de vagues de l'auteur.
 */
export function loiCouronneReglee({ length, couronne }) {
  const c = normaliserCouronne(couronne);
  if (!c || c.hauteur <= 0) return () => 0;
  const phase = (length * 7.13) % (Math.PI * 2);
  const forme = (t) => Math.sin(Math.PI * t) * (
    0.62 + 0.38 * Math.sin(Math.PI * 2 * c.ondes * t + phase)
    + 0.18 * Math.sin(Math.PI * 2 * c.ondes * 1.8 * t + 1.4 * phase));
  let crete = 0;
  for (let i = 0; i <= 240; i++) crete = Math.max(crete, forme(i / 240));
  const g = crete > 1e-6 ? c.hauteur / crete : 0;
  return (x) => {
    const t = clamp((length / 2 - x) / length, 0, 1);
    return Math.max(0, g * forme(t));
  };
}

/** L'écart le plus grand VERS L'EXTÉRIEUR d'un réglage (pour agrandir le sol et le plafond). */
export function debordExterieur(reglage) {
  if (!reglage) return 0;
  if (reglage.points?.length) return Math.max(0, ...profilVectoriel(reglage.points).map(([, d]) => d));
  if (reglage.sens === 'bombe' && (reglage.ondes ?? 1) === 1) return 0;
  return reglage.profondeur ?? 0;
}

/** Le plus grand débord extérieur de toute la coque. */
export function debordCoque(courbe) {
  const c = normaliserCourbe(courbe);
  if (!c) return 0;
  return Math.max(0, ...MURS.map((m) => debordExterieur(courbeDuMur(c, m))));
}

/* ----------------------------------------------- le mur et le plan de l'espace --- */

/**
 * La GÉOMÉTRIE d'un mur dans le plan de l'espace (repère local de la
 * pièce, la coque centrée) : sa longueur, et de quoi passer d'un point
 * (t, d) du mur à (x, z) dans l'espace — et retour. Même pose que
 * RoomManager.buildShell : nord et sud le long de x, est et ouest le long
 * de −z (le mur tourné d'un quart de tour), d positif vers l'extérieur.
 */
export function geometrieMur(mur, { width, depth, epaisseur = 0 }) {
  const w = Number(width), d = Number(depth);
  const L = mur === 'nord' || mur === 'sud' ? w + epaisseur : d - epaisseur;
  const versPlan = (t, dd) => {
    const xm = -L / 2 + t * L;
    if (mur === 'nord') return [xm, -d / 2 - dd];
    if (mur === 'sud') return [xm, d / 2 + dd];
    if (mur === 'est') return [w / 2 + dd, -xm];
    return [-w / 2 - dd, -xm];
  };
  const depuisPlan = (x, z) => {
    let xm, dd;
    if (mur === 'nord') { xm = x; dd = -d / 2 - z; }
    else if (mur === 'sud') { xm = x; dd = z - d / 2; }
    else if (mur === 'est') { xm = -z; dd = x - w / 2; }
    else { xm = -z; dd = -w / 2 - x; }
    return [(xm + L / 2) / L, dd];
  };
  return { mur, longueur: L, versPlan, depuisPlan };
}

/* ------------------------------------------------- éditer une courbe libre --- */

/** Ajoute une ancre en t, posée SUR la courbe actuelle du mur (rien ne saute). */
export function ajouterAncre(reglage, t, { longueur = 10, height = 4 } = {}) {
  const loi = loiVoileReglee({ length: longueur, height, reglage });
  const d = loi(-longueur / 2 + clamp(t, 0, 1) * longueur, height);
  const points = [...(reglage.points ?? []), { t, d }];
  return normaliserPoints(points);
}

/** Retire l'ancre d'indice i. */
export function retirerAncre(points, i) {
  return normaliserPoints((points ?? []).filter((_, k) => k !== i));
}

/**
 * Déplace une ancre ou l'une de ses poignées. `quoi` : 'ancre' | 'avant' |
 * 'apres' ; (t, d) : la nouvelle position ABSOLUE sur le mur. Une poignée
 * déplacée entraîne sa jumelle en miroir (tangente lisse), sauf
 * `{ casse: true }` — l'Alt de GIMP. La jumelle garde sa longueur EN
 * MÈTRES sur le plan : `longueur` est celle du mur (t en est la fraction).
 */
export function deplacerPoint(points, i, quoi, t, d, { casse = false, longueur = 1 } = {}) {
  const pts = (normaliserPoints(points) ?? []).map((p) => ({ ...p, avant: [...p.avant], apres: [...p.apres] }));
  const p = pts[i];
  if (!p) return pts;
  if (quoi === 'ancre') {
    const tPrec = i === 0 ? 0 : pts[i - 1].t;
    const tSuiv = i === pts.length - 1 ? 1 : pts[i + 1].t;
    p.t = clamp(t, tPrec + 0.003, tSuiv - 0.003);
    p.d = d;
  } else {
    const v = [t - p.t, d - p.d];
    if (quoi === 'apres') p.apres = v; else p.avant = v;
    if (!casse) {
      const autre = quoi === 'apres' ? 'avant' : 'apres';
      const L = longueur > 0 ? longueur : 1;
      const garde = Math.hypot(p[autre][0] * L, p[autre][1]);
      const n = Math.hypot(v[0] * L, v[1]) || 1;
      // le sens opposé sur le plan (x = t·L), à la longueur gardée, ramené en (t, d)
      p[autre] = [-v[0] / n * garde, -v[1] / n * garde];
    }
  }
  return normaliserPoints(pts);
}
