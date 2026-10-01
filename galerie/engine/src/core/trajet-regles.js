/**
 * LE TRAJET D'UNE ŒUVRE — les règles pures du module `Trajet`
 * (modules/Trajet.js) : une œuvre, et avec elle sa source sonore, se
 * déplace en boucle sur un CHEMIN.
 *
 * Le chemin PART DE L'OBJET, là où l'auteur l'a posé : ses points sont des
 * décalages en mètres depuis cette position. Trois formes :
 *
 *   • `ligne`  : de l'objet à un point d'arrivée (`points[0]`), et retour ;
 *   • `cercle` : un cercle de `rayon` qui passe par l'objet, dans un `plan`
 *                (horizontal, ou vertical de face ou de côté) ;
 *   • `courbe` : une courbe douce (Catmull-Rom) par l'objet puis chaque
 *                point de `points` — `fermee`, elle revient à l'objet en
 *                boucle ; ouverte, l'œuvre fait l'aller et le retour.
 *
 * Le parcours est ÉCHANTILLONNÉ en une polyligne aux longueurs cumulées :
 * la position à une fraction du chemin s'y lit par longueur d'arc, donc à
 * vitesse constante, quelle que soit la forme — une courbe serrée ne fait
 * pas accélérer l'œuvre. `duree` est le temps d'un cycle complet (un
 * aller-retour, ou un tour) ; `phase` décale le départ ; les allers-retours
 * s'adoucissent aux extrémités (l'œuvre ralentit, repart) pour que la
 * source ne « rebondisse » pas à l'oreille.
 *
 * Aucune dépendance à three : testé au nœud (scripts/test-trajet.mjs).
 */

export const FORMES_TRAJET = {
  ligne: { nom: 'une ligne, aller et retour' },
  cercle: { nom: 'un cercle' },
  courbe: { nom: 'une courbe par des points' }
};
export const PLANS_TRAJET = {
  horizontal: { nom: 'horizontal (au sol)' },
  face: { nom: 'vertical, de face' },
  cote: { nom: 'vertical, de côté' }
};
export const TRAJET_DEFAUT = Object.freeze({
  forme: 'ligne', duree: 20, rayon: 2, plan: 'horizontal', phase: 0,
  allerRetour: true, fermee: false, orienter: false, points: [[3, 0, 0]]
});
export const BORNES_TRAJET = Object.freeze({ dureeMin: 1, dureeMax: 600, rayonMin: 0.1, rayonMax: 60, portee: 200, maxPoints: 24 });

const arrondi = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const nombre = (v, repli) => { const n = Number(v); return Number.isFinite(n) ? n : repli; };

/** Un point [x, y, z] en mètres, borné à la portée ; null s'il n'en est pas un. */
export function normaliserPoint(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const c = [0, 1, 2].map((i) => arrondi(clamp(nombre(p[i], 0), -BORNES_TRAJET.portee, BORNES_TRAJET.portee)));
  return c;
}

/** Les paramètres du module, complets et bornés. */
export function normaliserTrajet(brut = {}) {
  const b = brut && typeof brut === 'object' ? brut : {};
  const forme = FORMES_TRAJET[b.forme] ? b.forme : TRAJET_DEFAUT.forme;
  let points = (Array.isArray(b.points) ? b.points : []).map(normaliserPoint).filter(Boolean).slice(0, BORNES_TRAJET.maxPoints);
  if (forme === 'ligne') points = [points[0] ?? TRAJET_DEFAUT.points[0]];
  if (forme === 'courbe' && !points.length) points = [[3, 0, 0], [3, 0, 3]];
  const fermee = forme === 'courbe' ? Boolean(b.fermee) : forme === 'cercle';
  return {
    forme,
    duree: arrondi(clamp(nombre(b.duree, TRAJET_DEFAUT.duree), BORNES_TRAJET.dureeMin, BORNES_TRAJET.dureeMax)),
    rayon: arrondi(clamp(nombre(b.rayon, TRAJET_DEFAUT.rayon), BORNES_TRAJET.rayonMin, BORNES_TRAJET.rayonMax)),
    plan: PLANS_TRAJET[b.plan] ? b.plan : TRAJET_DEFAUT.plan,
    phase: arrondi(clamp(nombre(b.phase, 0), 0, 1)),
    // un chemin fermé se parcourt en boucle ; ouvert, l'aller-retour est la règle
    allerRetour: fermee ? false : (b.allerRetour === undefined ? true : Boolean(b.allerRetour)),
    fermee,
    orienter: Boolean(b.orienter),
    points
  };
}

/* ------------------------------------------------------------ formes --- */

/** Le cercle passe par l'origine : son centre est à un rayon de l'objet. */
function cercle(t, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = t.rayon * (Math.cos(a) - 1), v = t.rayon * Math.sin(a);
    if (t.plan === 'face') pts.push([u, v, 0]);        // le plan XY : debout, face au visiteur
    else if (t.plan === 'cote') pts.push([0, v, u]);   // le plan YZ : debout, de profil
    else pts.push([u, 0, v]);                          // le plan XZ : au sol
  }
  return pts;
}

/** Catmull-Rom uniforme par les points donnés (fermée : la boucle se referme). */
function catmullRom(points, fermee, parSegment = 16) {
  const n = points.length;
  if (n < 2) return points.slice();
  const P = (i) => points[fermee ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const out = [];
  const segments = fermee ? n : n - 1;
  for (let s = 0; s < segments; s++) {
    const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
    for (let k = 0; k < parSegment; k++) {
      const u = k / parSegment, u2 = u * u, u3 = u2 * u;
      out.push([0, 1, 2].map((c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * u
        + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3)));
    }
  }
  if (!fermee) out.push(points[n - 1].slice());
  return out;
}

/**
 * Le PARCOURS : la polyligne du chemin (décalages depuis l'objet), ses
 * longueurs cumulées, sa longueur totale, et s'il est fermé.
 */
export function parcoursDe(trajet) {
  const t = normaliserTrajet(trajet);
  let pts;
  if (t.forme === 'cercle') pts = cercle(t);
  else if (t.forme === 'courbe') pts = catmullRom([[0, 0, 0], ...t.points], t.fermee);
  else pts = [[0, 0, 0], t.points[0]];
  if (t.fermee) pts = [...pts, [0, 0, 0]];   // la boucle revient à l'objet
  const cumul = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cumul.push(cumul[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { points: pts, cumul, total: cumul[cumul.length - 1], ferme: t.fermee, trajet: t };
}

/* ------------------------------------------------------------- temps --- */

const douce = (x) => x * x * (3 - 2 * x);   // smoothstep : l'œuvre ralentit aux bouts

/**
 * La FRACTION DU CHEMIN parcourue à l'instant `temps` (secondes) : 0 à
 * l'objet, 1 au bout. En aller-retour, un cycle fait l'aller puis le
 * retour, adoucis ; en boucle, la fraction tourne.
 */
export function avancement(trajet, temps) {
  const t = normaliserTrajet(trajet);
  const u = (((nombre(temps, 0) / t.duree) + t.phase) % 1 + 1) % 1;
  if (!t.allerRetour) return u;
  return u < 0.5 ? douce(u * 2) : douce((1 - u) * 2);
}

/** Le point du parcours à la fraction `s` (0…1), et la tangente unitaire. */
export function pointSurParcours(parcours, s) {
  const { points, cumul, total } = parcours;
  if (points.length < 2 || total <= 0) return { point: [...(points[0] ?? [0, 0, 0])], tangente: [0, 0, 1] };
  const d = clamp(s, 0, 1) * total;
  let i = 1;
  while (i < cumul.length - 1 && cumul[i] < d) i++;
  const a = points[i - 1], b = points[i];
  const L = cumul[i] - cumul[i - 1];
  const f = L > 0 ? (d - cumul[i - 1]) / L : 0;
  const point = [0, 1, 2].map((c) => arrondi(a[c] + (b[c] - a[c]) * f));
  const tangente = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...tangente) || 1;
  return { point, tangente: tangente.map((c) => c / n) };
}

/**
 * Tout en un : le décalage de l'œuvre et sa direction à l'instant `temps`.
 * En aller-retour, la tangente se retourne au retour — l'œuvre regarde où
 * elle va. `parcours` vient de parcoursDe (à garder entre deux appels).
 */
export function positionSurTrajet(parcours, temps) {
  const t = parcours.trajet;
  const s = avancement(t, temps);
  const r = pointSurParcours(parcours, s);
  if (t.allerRetour) {
    const u = (((nombre(temps, 0) / t.duree) + t.phase) % 1 + 1) % 1;
    if (u >= 0.5) r.tangente = r.tangente.map((c) => (c === 0 ? 0 : -c));
  }
  return r;
}

/** L'angle (radians, autour de la verticale) qui regarde dans une direction. */
export function capVers(tangente) {
  const [x, , z] = tangente;
  return (Math.abs(x) + Math.abs(z)) < 1e-6 ? 0 : Math.atan2(x, z);
}
