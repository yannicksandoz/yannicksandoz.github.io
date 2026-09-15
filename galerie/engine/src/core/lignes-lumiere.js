import * as THREE from 'three';
import { DECLARATION_AMBIANCE, uniformesAmbiance } from './ambiance-salle.js';
import { patcherReflets } from './reflets.js';
import { patcherNormaleSure } from './textures.js';

/**
 * LES LIGNES DE LUMIÈRE — une corniche qui éclaire pour le prix d'un point.
 *
 * LE PROBLÈME, MESURÉ. Sur téléphone, la galerie perdait ses corniches :
 * une `RectAreaLight` intègre une BRDF pré-tabulée (LTC) par pixel et par
 * lampe, et quatre bandeaux de 46 m coûtaient 26 % du temps d'image. Le
 * profil mobile les coupait donc toutes (`sourcesEtendues: 0`) et posait à
 * la place UN cône par corniche. Or une corniche n'est pas un point : le
 * cône partait du milieu du bandeau, brûlait le centre du mur et laissait
 * les extrémités noires — et il concourait pour trois emplacements de cône
 * seulement, si bien qu'une salle à quatre corniches en perdait une au
 * hasard de la distance. Relevé au navigateur, profil iPhone contre
 * bureau, même cadrage : le labo tombait de 63,8 à 10,3 de clarté moyenne
 * avec 87 % de l'image en noir pur, les archives de 107 à 18, la
 * bibliothèque de 124 à 31. « Les lumières quasi inexistantes. »
 *
 * LE REMÈDE. Une corniche est un SEGMENT. L'éclairement qu'un segment
 * uniforme donne en un point a une forme close — pas une approximation, la
 * solution exacte de l'intégrale — et elle tient en une quinzaine
 * d'opérations, sans la moindre texture.
 *
 * Pour un point de surface pris à l'origine, de normale n, et un segment
 * d'extrémités a et b (relatives à ce point), l'éclairement vaut
 * E = I · (n · V) où V est le vecteur d'éclairement du segment :
 *
 *     V = ∫ x̂ / r² ds   le long du segment.
 *
 * En posant d̂ la direction du segment, s₀ = −(a·d̂) l'abscisse du pied de
 * la perpendiculaire, p = a + s₀·d̂ ce pied, h² = |p|², rₐ = |a|, r_b = |b|,
 * u₁ = −s₀ et u₂ = L − s₀, l'intégrale se sépare en une composante le long
 * de p et une le long de d̂, toutes deux élémentaires :
 *
 *     V = (p / h²) · (u₂/r_b − u₁/rₐ)  +  d̂ · (1/rₐ − 1/r_b)
 *
 * Vérifié contre une intégration numérique à 200 000 pas sur 793
 * configurations tirées au hasard, segments quasi ponctuels compris :
 * erreur relative maximale 9,4·10⁻⁷ %. C'est la même famille de solutions
 * analytiques que les moteurs de jeu emploient pour leurs sources
 * linéaires (néons, rampes, tubes) ; on l'a redérivée ici plutôt que de
 * l'emprunter, et le test `test-lignes-lumiere.mjs` la confronte de
 * nouveau à l'intégration numérique à chaque `npm test`.
 *
 * L'HORIZON. La forme close intègre TOUT le segment, y compris la part
 * passée derrière la surface, qui ne devrait rien donner. On coupe donc le
 * segment sur le plan n·x = 0 avant de l'évaluer : une comparaison, une
 * interpolation. Sans cela un mur recevrait de la lumière par l'arrière.
 *
 * CE QUE ÇA CHANGE, ET CE QUE ÇA NE FAIT PAS. La ligne rend le dégradé sur
 * toute la longueur du mur, ce qu'aucun point ne sait faire : la même
 * puissance concentrée au milieu d'un bandeau de 40 m donne 1,99 × trop au
 * centre et rien aux bouts (mesuré). En revanche on ne calcule que le
 * DIFFUS — le reflet spéculaire d'une ligne demanderait son propre point
 * représentatif, et sur des surfaces mates de galerie il ne se voit pas.
 *
 * LA COURBE. En style fluide, le bandeau d'une corniche est plié sur le
 * voile qu'il longe (voir `Artwork._courberCorniche`), et ses sommets
 * portent la vraie polyligne. On y prélève donc les extrémités des
 * segments : la lumière suit exactement le trait qu'on voit, au lieu de
 * tendre une corde par-dessus le creux du couronnement.
 *
 * LE REPÈRE. Tout est calculé en espace VUE : `geometryPosition` et
 * `geometryNormal` y sont déjà, et l'on évite un varying de position monde.
 * Les extrémités sont donc transportées à chaque image — quelques dizaines
 * de multiplications de matrices, rien qui se mesure — ce qui a l'avantage
 * de suivre gratuitement les bascules de gravité, où la pièce tourne.
 */

/**
 * Combien de segments le shader porte au plus. Au-delà, on garde les plus
 * proches — et la sonde d'ambiance reprend l'éclairement du reste.
 *
 * SEIZE, ET C'EST MESURÉ. La boucle GLSL sort à `uLigneNombre` : une salle
 * à huit corniches ou moins ne paie pas un cycle de plus qu'avant — seuls
 * le labo (15), l'entrée (19) et le belvédère (21) montent au-delà.
 * L'ordre 2 de la sonde avait été essayé d'abord et refusé (voir le
 * README) : le noir du labo venait des corniches que ce plafond coupait,
 * pas d'une ambiance trop grossière.
 *
 * A/B/A sur le même navigateur, profil iPhone 13, dérive encadrée à ~1 % :
 * le labo paie +5,8 % de temps d'image et passe de 0,56 à 0,94 de la
 * clarté du bureau, son noir pur de 30,6 % à 3,2 % ; le belvédère ne paie
 * rien (−0,4 %, dans le bruit — ses pixels sont surtout du ciel) et ne
 * gagne rien non plus : son écart restant n'est PAS dans les corniches.
 * C'est ce chiffre qui a rouvert le plafond ; si quelqu'un vise 24, qu'il
 * refasse la mesure.
 */
export const MAX_LIGNES = 16;

/**
 * LES POLYLIGNES — une corniche pliée, suivie là où on la regarde.
 *
 * Mesuré au labo : une corniche de 42 m sur un mur à ciel ouvert plonge
 * avec le couronnement de près de 2 m ; en trois cordes, l'écart au trait
 * restait de 1,77 m. Le lavage sur le mur dessinait alors un néon DROIT
 * sous un trait qui ondule, avec une zone sombre partout où le trait
 * descend sous sa corde. Suivre le trait à 30 cm près demande seize
 * segments par corniche — soixante-quatre par pixel pour le labo, hors de
 * prix en boucle plate.
 *
 * Or un pixel n'est éclairé, en 1/r², que par la part du trait qui lui est
 * PROCHE. On garde donc la polyligne entière (dix-sept points) et, par
 * pixel, on n'intègre exactement que la FENÊTRE de segments autour du
 * point le plus proche — repéré par la projection du pixel sur l'axe du
 * trait, un produit scalaire — et les deux restes du trait comme deux
 * cordes, dont l'erreur ne pèse plus rien à cette distance. Cinq
 * évaluations par corniche, quelle que soit sa finesse ; le trait est
 * exact là où le mur le montre, droit là où il ne se voit pas.
 */
export const MAX_POLYLIGNES = 4;
export const MAX_POINTS_POLYLIGNE = 17;   // seize segments : 30 cm d'écart au trait du labo
export const FENETRE = 1;                 // segments de part et d'autre du plus proche

/**
 * Les lignes ne servent QUE là où les sources étendues ne sont pas
 * payables. L'App le décide une fois, au démarrage, en même temps que le
 * budget de `RectAreaLight` (voir Quality). Le module ne va pas le
 * chercher lui-même : importer `primitives` ferait entrer tout le
 * catalogue de matières — et ses images — dans un fichier qu'on veut
 * pouvoir éprouver sans navigateur.
 */
let actif = false;
export function activerLignes(oui) { actif = Boolean(oui); }
export function lignesActives() { return actif; }

/**
 * LE BUDGET PAR PIXEL. Le shader boucle sur `MAX_LIGNES` segments mais
 * s'arrête à `uLigneNombre` : c'est ce nombre que le profil règle
 * (Quality, `lignesProches`). Chaque segment coûte une trentaine
 * d'opérations par pixel sur chaque surface éclairée — seize au belvédère
 * sur téléphone, c'est un tiers de l'image. Ce que le shader ne porte pas,
 * la sonde d'ambiance le porte (poids 1 dans `ponderer`) : la salle ne
 * s'assombrit pas, le dégradé au mur s'en va.
 */
let budget = MAX_LIGNES;
export function reglerBudgetLignes(n) {
  budget = Math.max(0, Math.min(MAX_LIGNES, Number.isFinite(n) ? Math.round(n) : MAX_LIGNES));
}
export function budgetLignes() { return budget; }

/** Toutes les lignes déclarées pour la salle courante. */
const lignes = [];
/** …et les polylignes (corniches pliées), voir MAX_POLYLIGNES. */
const polylignes = [];

/**
 * Les uniformes sont PARTAGÉS par tous les matériaux corrigés : un seul
 * objet, référencé partout, mis à jour une fois par image. Sans cela,
 * chaque matériau garderait sa copie et il faudrait les parcourir tous.
 */
const UNIFORMES = {
  uLigneA: { value: Array.from({ length: MAX_LIGNES }, () => new THREE.Vector3()) },
  uLigneB: { value: Array.from({ length: MAX_LIGNES }, () => new THREE.Vector3()) },
  uLigneCouleur: { value: Array.from({ length: MAX_LIGNES }, () => new THREE.Color()) },
  // la NORMALE de la fente, en espace vue : une corniche n'éclaire que
  // devant elle, comme la source rectangulaire qu'elle remplace
  uLigneFace: { value: Array.from({ length: MAX_LIGNES }, () => new THREE.Vector3(0, 0, 1)) },
  uLigneNombre: { value: 0 },
  // les polylignes, à plat : la k-ième occupe les points [k·MAX_POINTS, k·MAX_POINTS + n)
  uPolyPts: { value: Array.from({ length: MAX_POLYLIGNES * MAX_POINTS_POLYLIGNE }, () => new THREE.Vector3()) },
  uPolyN: { value: new Int32Array(MAX_POLYLIGNES) },
  uPolyCouleur: { value: Array.from({ length: MAX_POLYLIGNES }, () => new THREE.Color()) },
  uPolyFace: { value: Array.from({ length: MAX_POLYLIGNES }, () => new THREE.Vector3(0, 0, 1)) },
  uPolyNombre: { value: 0 }
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _cam = new THREE.Vector3();

/** Oublie toutes les lignes — à l'entrée dans une salle. */
export function reinitialiserLignes() {
  lignes.length = 0;
  polylignes.length = 0;
  UNIFORMES.uLigneNombre.value = 0;
  UNIFORMES.uPolyNombre.value = 0;
}

/**
 * Déclare une ligne de lumière.
 *
 * `objet` porte le repère : les extrémités sont données DANS SON ESPACE
 * LOCAL, et suivent donc ses rotations (bascules de gravité comprises).
 * `intensite` est une puissance par unité de longueur, calibrée en aval
 * pour rejoindre la clarté que la source étendue donnait au bureau.
 */
export function ajouterLigne({ objet, a, b, couleur, intensite = 1, face = [0, 0, 1] }) {
  if (!objet || !a || !b) return null;
  const ligne = {
    objet,
    a: new THREE.Vector3().fromArray(a),
    b: new THREE.Vector3().fromArray(b),
    face: new THREE.Vector3().fromArray(face).normalize(),
    couleur: new THREE.Color(couleur ?? 0xffffff).multiplyScalar(intensite),
    // repères de travail, réutilisés chaque image : aucune allocation
    _a: new THREE.Vector3(), _b: new THREE.Vector3(), _f: new THREE.Vector3(), _d: 0
  };
  lignes.push(ligne);
  return ligne;
}

export function nombreDeLignes() { return lignes.length; }

/**
 * Déclare une POLYLIGNE de lumière : le trait d'une corniche pliée, par
 * ses points (dans l'espace local d'`objet`), de deux à MAX_POINTS. Au-delà
 * on rééchantillonne à MAX_POINTS points, à égale distance d'indice.
 */
export function ajouterPolyligne({ objet, points, couleur, intensite = 1, face = [0, 0, 1] }) {
  if (!objet || !Array.isArray(points) || points.length < 2) return null;
  let pts = points;
  if (pts.length > MAX_POINTS_POLYLIGNE) {
    pts = Array.from({ length: MAX_POINTS_POLYLIGNE },
      (_, i) => points[Math.round(i * (points.length - 1) / (MAX_POINTS_POLYLIGNE - 1))]);
  }
  const poly = {
    objet,
    points: pts.map((q) => new THREE.Vector3().fromArray(q)),
    face: new THREE.Vector3().fromArray(face).normalize(),
    couleur: new THREE.Color(couleur ?? 0xffffff).multiplyScalar(intensite),
    _pts: pts.map(() => new THREE.Vector3()), _f: new THREE.Vector3(), _d: 0
  };
  polylignes.push(poly);
  return poly;
}

export function nombreDePolylignes() { return polylignes.length; }

/**
 * Les segments d'une salle, en MONDE, pour la sonde d'ambiance — elle
 * travaille hors caméra et ne peut pas lire les uniformes d'espace vue.
 */
export function segmentsMonde(salle, camera = null) {
  const sortie = [];
  const dansLaSalle = (objet) => {
    let n = objet;
    while (n) { if (n === salle?.group) return true; n = n.parent; }
    return false;
  };
  for (const l of lignes) {
    if (!dansLaSalle(l.objet)) continue;
    l.objet.updateWorldMatrix(true, false);
    sortie.push({
      a: l.a.clone().applyMatrix4(l.objet.matrixWorld),
      b: l.b.clone().applyMatrix4(l.objet.matrixWorld),
      face: l.face.clone().transformDirection(l.objet.matrixWorld),
      couleur: l.couleur
    });
  }
  // une polyligne : ses segments, un par un — la sonde intègre au CPU, le
  // nombre ne lui coûte rien ; le shader, lui, la porte toujours (`portee`)
  for (const q of polylignes) {
    if (!dansLaSalle(q.objet)) continue;
    q.objet.updateWorldMatrix(true, false);
    const face = q.face.clone().transformDirection(q.objet.matrixWorld);
    for (let i = 0; i + 1 < q.points.length; i++) {
      sortie.push({
        a: q.points[i].clone().applyMatrix4(q.objet.matrixWorld),
        b: q.points[i + 1].clone().applyMatrix4(q.objet.matrixWorld),
        face, couleur: q.couleur, portee: true
      });
    }
  }
  return camera ? ponderer(sortie, camera) : sortie;
}

/**
 * LES CORNICHES QUE LE SHADER NE PORTE PAS.
 *
 * Même défaut que pour les lampes, une couche plus loin, et il coûtait
 * plus cher encore. `majLignes` ne transporte que les `MAX_LIGNES`
 * segments les plus proches : le labo en déclare quinze, le belvédère
 * vingt et un. Sept et treize corniches n'étaient donc pas approchées,
 * elles étaient SUPPRIMÉES — dans les deux salles ouvertes, c'est-à-dire
 * précisément celles qui restaient sombres sur téléphone.
 *
 * On pose donc le même poids que pour les lampes : `ALBEDO_REBOND` pour
 * celles que le shader calcule par pixel (la sonde n'ajoute que le
 * rebond), 1 pour les autres (la sonde porte tout leur éclairement).
 *
 * Le critère de tri est le MÊME que celui de `majLignes` — distance au
 * milieu du segment. Il le faut : deux règles différentes donneraient une
 * corniche comptée deux fois ici et pas du tout là.
 */
function ponderer(segments, camera) {
  camera.getWorldPosition(_cam);
  for (const s of segments) {
    _mid.copy(s.a).add(s.b).multiplyScalar(0.5);
    s._d = _mid.distanceToSquared(_cam);
  }
  // les segments d'une polyligne sont portés par le shader (fenêtre et
  // cordes) : la sonde n'ajoute que leur rebond, comme pour les lignes
  // retenues — seules les lignes simples concourent au budget
  const ordre = segments.filter((s) => !s.portee).sort((x, y) => x._d - y._d);
  ordre.forEach((s, i) => { s.poids = i < budget ? null : 1; });
  for (const s of segments) if (s.portee) s.poids = null;
  return segments;
}

/**
 * Transporte les segments en espace vue et garde les plus proches.
 *
 * On mesure la distance au MILIEU du segment : un critère par extrémité
 * ferait préférer une corniche lointaine dont un bout passe près, et l'on
 * verrait la sélection sauter en marchant.
 */
/**
 * LE FONDU DES LIGNES. Le budget garde les `budget` segments les plus
 * proches ; en marchant, la sélection change et une corniche entrait ou
 * sortait du shader d'un coup. Chaque ligne porte un poids `_w` (0..1)
 * qui monte vers 1 quand elle est retenue et descend vers 0 sinon, en
 * DUREE_FONDU_LIGNES secondes ; une ligne qui descend reste transportée
 * tant qu'elle pèse, dans la limite de MAX_LIGNES emplacements. Sa couleur
 * est multipliée par ce poids.
 */
export const DUREE_FONDU_LIGNES = 0.6;

export function majLignes(camera, dt = 0) {
  if (!camera || (!lignes.length && !polylignes.length)) {
    UNIFORMES.uLigneNombre.value = 0;
    UNIFORMES.uPolyNombre.value = 0;
    return 0;
  }
  camera.getWorldPosition(_cam);
  const polys = majPolylignes(camera);
  if (!lignes.length) { UNIFORMES.uLigneNombre.value = 0; return polys; }
  const vivantes = [];
  for (let i = lignes.length - 1; i >= 0; i--) {
    const l = lignes[i];
    // UNE SALLE À LA FOIS. Toutes les salles vivent dans la même scène et
    // se superposent à l'origine ; seule la courante est visible
    // (RoomManager : `room.group.visible = room.isCurrent`). Filtrer sur
    // la visibilité suffit donc à ne garder que les corniches de la salle
    // où l'on est — sans registre parallèle à tenir à jour, et sans se
    // tromper le jour où l'éditeur en montre deux.
    let n = l.objet, attache = true, vu = true;
    while (n) {
      if (!n.visible) { vu = false; break; }
      if (!n.parent) attache = n.type === 'Scene' || Boolean(n.isScene);
      n = n.parent;
    }
    // une salle détruite emporte ses lignes : on les retire du registre
    if (!attache) { lignes.splice(i, 1); continue; }
    if (!vu) continue;
    l.objet.updateWorldMatrix(true, false);
    l._a.copy(l.a).applyMatrix4(l.objet.matrixWorld);
    l._b.copy(l.b).applyMatrix4(l.objet.matrixWorld);
    // la normale ne se translate pas : seule la rotation compte
    l._f.copy(l.face).transformDirection(l.objet.matrixWorld);
    _mid.copy(l._a).add(l._b).multiplyScalar(0.5);
    l._d = _mid.distanceToSquared(_cam);
    vivantes.push(l);
  }
  if (!vivantes.length) { UNIFORMES.uLigneNombre.value = 0; return polys; }
  vivantes.sort((x, y) => x._d - y._d);
  // les `budget` plus proches sont voulues ; les autres descendent
  const pas = dt > 0 ? dt / DUREE_FONDU_LIGNES : 1;
  for (let i = 0; i < vivantes.length; i++) {
    const l = vivantes[i];
    const veut = i < budget;
    if (l._w === undefined) l._w = veut ? 1 : 0;   // une salle où l'on entre s'allume telle quelle
    l._w = veut ? Math.min(1, l._w + pas) : Math.max(0, l._w - pas);
  }
  // on transporte ce qui pèse : les voulues d'abord (elles montent ou sont
  // pleines), puis celles qui descendent, jusqu'à MAX_LIGNES
  const transportees = vivantes.filter((l) => l._w > 0).slice(0, MAX_LIGNES);

  for (let i = 0; i < transportees.length; i++) {
    const l = transportees[i];
    UNIFORMES.uLigneA.value[i].copy(_a.copy(l._a).applyMatrix4(camera.matrixWorldInverse));
    UNIFORMES.uLigneB.value[i].copy(_b.copy(l._b).applyMatrix4(camera.matrixWorldInverse));
    UNIFORMES.uLigneCouleur.value[i].copy(l.couleur).multiplyScalar(l._w);
    UNIFORMES.uLigneFace.value[i].copy(l._f).transformDirection(camera.matrixWorldInverse);
  }
  UNIFORMES.uLigneNombre.value = transportees.length;
  return transportees.length + polys;
}

/** Les poids courants des lignes (pour les tests) : [{ w, d }] dans l'ordre de déclaration. */
export function poidsDesLignes() { return lignes.map((l) => ({ w: l._w ?? null, d: l._d })); }

/** Une salle vivante et visible porte l'objet ; sinon on l'oublie (true = à retirer). */
function orpheline(objet) {
  let n = objet, attache = true, vu = true;
  while (n) {
    if (!n.visible) { vu = false; break; }
    if (!n.parent) attache = n.type === 'Scene' || Boolean(n.isScene);
    n = n.parent;
  }
  return { attache, vu };
}

/** Transporte les polylignes en espace vue ; les MAX_POLYLIGNES plus proches. */
function majPolylignes(camera) {
  if (!polylignes.length) { UNIFORMES.uPolyNombre.value = 0; return 0; }
  const vivantes = [];
  for (let i = polylignes.length - 1; i >= 0; i--) {
    const q = polylignes[i];
    const { attache, vu } = orpheline(q.objet);
    if (!attache) { polylignes.splice(i, 1); continue; }
    if (!vu) continue;
    q.objet.updateWorldMatrix(true, false);
    for (let k = 0; k < q.points.length; k++) q._pts[k].copy(q.points[k]).applyMatrix4(q.objet.matrixWorld);
    q._f.copy(q.face).transformDirection(q.objet.matrixWorld);
    _mid.copy(q._pts[0]).add(q._pts[q.points.length - 1]).multiplyScalar(0.5);
    q._d = _mid.distanceToSquared(_cam);
    vivantes.push(q);
  }
  const retenues = vivantes.length <= MAX_POLYLIGNES
    ? vivantes : vivantes.sort((x, y) => x._d - y._d).slice(0, MAX_POLYLIGNES);
  for (let k = 0; k < retenues.length; k++) {
    const q = retenues[k];
    const base = k * MAX_POINTS_POLYLIGNE;
    for (let i = 0; i < q.points.length; i++) {
      UNIFORMES.uPolyPts.value[base + i].copy(_a.copy(q._pts[i]).applyMatrix4(camera.matrixWorldInverse));
    }
    UNIFORMES.uPolyN.value[k] = q.points.length;
    UNIFORMES.uPolyCouleur.value[k].copy(q.couleur);
    UNIFORMES.uPolyFace.value[k].copy(q._f).transformDirection(camera.matrixWorldInverse);
  }
  UNIFORMES.uPolyNombre.value = retenues.length;
  return retenues.length;
}

/**
 * LA FENÊTRE d'une polyligne, en JavaScript — la même règle qu'en GLSL,
 * pour les tests : les segments intégrés exactement autour du point le
 * plus proche (par l'axe), et les deux cordes qui portent le reste.
 * Rend { j, exacts: [[i, i+1]…], cordes: [[i0, i1]…] } en indices de points.
 */
export function fenetrePolyligne(P, pts, fenetre = FENETRE) {
  const n = pts.length;
  if (n < 2) return { j: 0, exacts: [], cordes: [] };
  const P0 = pts[0], Pn = pts[n - 1];
  const axe = [Pn[0] - P0[0], Pn[1] - P0[1], Pn[2] - P0[2]];
  const aa = Math.max(axe[0] ** 2 + axe[1] ** 2 + axe[2] ** 2, 1e-6);
  const t = Math.max(0, Math.min(1, ((P[0] - P0[0]) * axe[0] + (P[1] - P0[1]) * axe[1] + (P[2] - P0[2]) * axe[2]) / aa));
  const j = Math.max(0, Math.min(n - 2, Math.floor(t * (n - 1))));
  const j0 = Math.max(j - fenetre, 0), j1 = Math.min(j + fenetre, n - 2);
  const exacts = []; for (let i = j0; i <= j1; i++) exacts.push([i, i + 1]);
  const cordes = [];
  if (j0 > 0) cordes.push([0, j0]);
  if (j1 + 1 < n - 1) cordes.push([j1 + 1, n - 1]);
  return { j, exacts, cordes };
}

const DECLARATION = /* glsl */`
uniform vec3 uLigneA[${MAX_LIGNES}];
uniform vec3 uLigneB[${MAX_LIGNES}];
uniform vec3 uLigneCouleur[${MAX_LIGNES}];
uniform vec3 uLigneFace[${MAX_LIGNES}];
uniform int uLigneNombre;
uniform vec3 uPolyPts[${MAX_POLYLIGNES * MAX_POINTS_POLYLIGNE}];
uniform int uPolyN[${MAX_POLYLIGNES}];
uniform vec3 uPolyCouleur[${MAX_POLYLIGNES}];
uniform vec3 uPolyFace[${MAX_POLYLIGNES}];
uniform int uPolyNombre;

// L'éclairement d'un segment uniforme, forme close (voir l'en-tête).
vec3 irradianceLigne(vec3 P, vec3 N, vec3 A, vec3 B, vec3 F, vec3 couleur) {
  vec3 a = A - P;
  vec3 b = B - P;
  float na = dot(N, a);
  float nb = dot(N, b);
  // tout le segment derrière la surface : rien, et l'on sort tôt
  if (na <= 0.0 && nb <= 0.0) return vec3(0.0);
  // sinon on le coupe sur le plan de l'horizon n·x = 0
  if (na < 0.0) a = mix(a, b, na / (na - nb));
  else if (nb < 0.0) b = mix(b, a, nb / (nb - na));

  vec3 d = b - a;
  float L = length(d);
  if (L < 1e-4) return vec3(0.0);
  vec3 dh = d / L;
  float s0 = -dot(a, dh);
  vec3 p = a + dh * s0;              // pied de la perpendiculaire
  float h2 = max(dot(p, p), 1e-6);   // le point est sur la ligne : on borne
  float ra = max(length(a), 1e-4);
  float rb = max(length(b), 1e-4);
  vec3 V = p * ((L - s0) / rb + s0 / ra) / h2 + dh * (1.0 / ra - 1.0 / rb);

  // LA FACE DE LA FENTE. Une corniche n'éclaire que devant elle — la
  // source rectangulaire qu'elle remplace n'émet que vers son -Z. Sans
  // cette porte, la ligne rayonnait aussi vers l'arrière : mesuré, les
  // salles couvertes passaient à 1,15 et 1,31 fois la clarté du bureau,
  // le plafond recevant une lumière qui n'existe pas. On pondère par le
  // cosinus d'émission pris au point du segment LE PLUS PROCHE de la
  // surface — celui qui domine l'intégrale — ce qui annule exactement
  // l'hémisphère arrière et adoucit les incidences rasantes.
  // UN SEUL ÉCHANTILLON, et au point le plus proche. Essayé aussi : la
  // moyenne pondérée de trois points (extrémités + point proche). Elle est
  // plus sombre, et à tort — l'intégrale est en 1/r², l'énergie vient
  // presque toute du voisinage du point proche, tandis que les extrémités
  // d'un bandeau de 40 m sont loin ET rasantes. Mesuré : les archives
  // tombaient de 84,7 à 72,1 et la bibliothèque de 93,4 à 81,9. Une
  // moyenne uniforme sur un intégrande qui ne l'est pas se trompe.
  vec3 proche = a + dh * clamp(s0, 0.0, L);
  float cosE = max(dot(F, normalize(-proche)), 0.0);
  return couleur * (max(dot(N, V), 0.0) * cosE);
}

// LA POLYLIGNE (voir MAX_POLYLIGNES) : la fenêtre exacte autour du point
// le plus proche, deux cordes pour le reste. Le point le plus proche se
// repère par la projection du pixel sur l'AXE du trait (ses deux bouts) :
// un produit scalaire, et l'indice tombe.
vec3 polylignesIrradiance(vec3 P, vec3 N) {
  vec3 total = vec3(0.0);
  for (int k = 0; k < ${MAX_POLYLIGNES}; k++) {
    if (k >= uPolyNombre) break;
    int n = uPolyN[k];
    if (n < 2) continue;
    int base = k * ${MAX_POINTS_POLYLIGNE};
    vec3 P0 = uPolyPts[base];
    vec3 Pn = uPolyPts[base + n - 1];
    vec3 axe = Pn - P0;
    float t = clamp(dot(P - P0, axe) / max(dot(axe, axe), 1e-6), 0.0, 1.0);
    int j = clamp(int(floor(t * float(n - 1))), 0, n - 2);
    int j0 = max(j - ${FENETRE}, 0);
    int j1 = min(j + ${FENETRE}, n - 2);
    vec3 F = uPolyFace[k];
    vec3 C = uPolyCouleur[k];
    for (int s = 0; s <= ${2 * FENETRE}; s++) {
      int i = j0 + s;
      if (i > j1) break;
      total += irradianceLigne(P, N, uPolyPts[base + i], uPolyPts[base + i + 1], F, C);
    }
    if (j0 > 0) total += irradianceLigne(P, N, P0, uPolyPts[base + j0], F, C);
    if (j1 + 1 < n - 1) total += irradianceLigne(P, N, uPolyPts[base + j1 + 1], Pn, F, C);
  }
  return total;
}

vec3 lignesIrradiance(vec3 P, vec3 N) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGNES}; i++) {
    if (i >= uLigneNombre) break;
    total += irradianceLigne(P, N, uLigneA[i], uLigneB[i], uLigneFace[i], uLigneCouleur[i]);
  }
  return total + polylignesIrradiance(P, N);
}
`;

/**
 * Greffe les lignes sur un matériau, en préservant un `onBeforeCompile`
 * déjà posé (grain, stries, répétition en ont un). Idempotent : un
 * matériau partagé par toute une coque n'est corrigé qu'une fois.
 */
export function patcherLignes(material) {
  // LE BUREAU N'Y TOUCHE PAS. Là où les sources étendues sont payables,
  // les corniches restent des `RectAreaLight` et aucune ligne n'est
  // déclarée : greffer quand même ferait recompiler tous les shaders pour
  // une boucle qui sort au premier tour. On s'abstient donc entièrement —
  // le profil bureau garde exactement les programmes qu'il avait.
  if (!actif) return material;
  if (!material || material.userData?.lignesLumiere) return material;
  // seuls les matériaux qui s'éclairent : un bandeau émissif, une lueur ou
  // un ciel n'ont rien à recevoir
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return material;
  material.userData.lignesLumiere = true;

  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uLigneA = UNIFORMES.uLigneA;
    shader.uniforms.uLigneB = UNIFORMES.uLigneB;
    shader.uniforms.uLigneCouleur = UNIFORMES.uLigneCouleur;
    shader.uniforms.uLigneFace = UNIFORMES.uLigneFace;
    shader.uniforms.uLigneNombre = UNIFORMES.uLigneNombre;
    for (const nom of ['uPolyPts', 'uPolyN', 'uPolyCouleur', 'uPolyFace', 'uPolyNombre']) shader.uniforms[nom] = UNIFORMES[nom];
    for (const [nom, u] of Object.entries(uniformesAmbiance())) shader.uniforms[nom] = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>\n${DECLARATION}\n${DECLARATION_AMBIANCE}`)
      // APRÈS `lights_fragment_begin` : c'est là que `geometryPosition` et
      // `geometryNormal` existent, tous deux en espace vue, et que
      // `reflectedLight` attend ses contributions directes.
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        reflectedLight.directDiffuse += lignesIrradiance(geometryPosition, geometryNormal)
          * BRDF_Lambert(material.diffuseColor);
        // LE REBOND DE LA SALLE (voir ambiance-salle.js) : indirect, donc
        // il rejoint l'image d'environnement plutôt que la lumière directe.
        reflectedLight.indirectDiffuse += ambianceSalle(geometryNormal)
          * BRDF_Lambert(material.diffuseColor);`);
  };
  material.needsUpdate = true;
  return material;
}

/** Corrige tous les matériaux d'un sous-arbre. */
export function patcherArbreLignes(racine) {
  if (!racine) return;
  racine.traverse((o) => {
    const m = o.material;
    if (!m) return;
    // les LIGNES (profil mobile), les REFLETS de la salle (voir
    // reflets.js) et la GARDE de la normale (textures.js) se greffent au
    // même endroit : tout matériau standard, à sa naissance, reçoit ce que
    // la salle lui renvoie — et la promesse de ne jamais rendre l'infini
    const greffer = (x) => { patcherLignes(x); patcherReflets(x); patcherNormaleSure(x); };
    if (Array.isArray(m)) m.forEach(greffer);
    else greffer(m);
  });
}

/** Pour les tests : la même loi qu'en GLSL, en JavaScript. */
export function irradianceLigne(P, N, A, B) {
  const a = [A[0] - P[0], A[1] - P[1], A[2] - P[2]];
  const b = [B[0] - P[0], B[1] - P[1], B[2] - P[2]];
  const pt = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const na = pt(N, a), nb = pt(N, b);
  if (na <= 0 && nb <= 0) return 0;
  if (na < 0) { const t = na / (na - nb); for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * t; }
  else if (nb < 0) { const t = nb / (nb - na); for (let i = 0; i < 3; i++) b[i] += (a[i] - b[i]) * t; }
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-4) return 0;
  const dh = [d[0] / L, d[1] / L, d[2] / L];
  const s0 = -pt(a, dh);
  const p = [a[0] + dh[0] * s0, a[1] + dh[1] * s0, a[2] + dh[2] * s0];
  const h2 = Math.max(pt(p, p), 1e-6);
  const ra = Math.max(Math.hypot(a[0], a[1], a[2]), 1e-4);
  const rb = Math.max(Math.hypot(b[0], b[1], b[2]), 1e-4);
  const k = ((L - s0) / rb + s0 / ra) / h2;
  const V = [p[0] * k + dh[0] * (1 / ra - 1 / rb),
    p[1] * k + dh[1] * (1 / ra - 1 / rb),
    p[2] * k + dh[2] * (1 / ra - 1 / rb)];
  return Math.max(pt(N, V), 0);
}
