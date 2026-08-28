import * as THREE from 'three';
import { DECLARATION_AMBIANCE, uniformesAmbiance } from './ambiance-salle.js';

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

/** Combien de segments le shader porte au plus. Au-delà, on garde les plus proches. */
export const MAX_LIGNES = 8;

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

/** Toutes les lignes déclarées pour la salle courante. */
const lignes = [];

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
  uLigneNombre: { value: 0 }
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _cam = new THREE.Vector3();

/** Oublie toutes les lignes — à l'entrée dans une salle. */
export function reinitialiserLignes() {
  lignes.length = 0;
  UNIFORMES.uLigneNombre.value = 0;
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
 * Les segments d'une salle, en MONDE, pour la sonde d'ambiance — elle
 * travaille hors caméra et ne peut pas lire les uniformes d'espace vue.
 */
export function segmentsMonde(salle) {
  const sortie = [];
  for (const l of lignes) {
    let n = l.objet, dedans = false;
    while (n) { if (n === salle?.group) { dedans = true; break; } n = n.parent; }
    if (!dedans) continue;
    l.objet.updateWorldMatrix(true, false);
    sortie.push({
      a: l.a.clone().applyMatrix4(l.objet.matrixWorld),
      b: l.b.clone().applyMatrix4(l.objet.matrixWorld),
      face: l.face.clone().transformDirection(l.objet.matrixWorld),
      couleur: l.couleur
    });
  }
  return sortie;
}

/**
 * Transporte les segments en espace vue et garde les plus proches.
 *
 * On mesure la distance au MILIEU du segment : un critère par extrémité
 * ferait préférer une corniche lointaine dont un bout passe près, et l'on
 * verrait la sélection sauter en marchant.
 */
export function majLignes(camera) {
  if (!lignes.length || !camera) {
    UNIFORMES.uLigneNombre.value = 0;
    return 0;
  }
  camera.getWorldPosition(_cam);
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
  if (!vivantes.length) { UNIFORMES.uLigneNombre.value = 0; return 0; }
  const retenues = vivantes.length <= MAX_LIGNES
    ? vivantes
    : vivantes.sort((x, y) => x._d - y._d).slice(0, MAX_LIGNES);

  for (let i = 0; i < retenues.length; i++) {
    const l = retenues[i];
    UNIFORMES.uLigneA.value[i].copy(_a.copy(l._a).applyMatrix4(camera.matrixWorldInverse));
    UNIFORMES.uLigneB.value[i].copy(_b.copy(l._b).applyMatrix4(camera.matrixWorldInverse));
    UNIFORMES.uLigneCouleur.value[i].copy(l.couleur);
    UNIFORMES.uLigneFace.value[i].copy(l._f).transformDirection(camera.matrixWorldInverse);
  }
  UNIFORMES.uLigneNombre.value = retenues.length;
  return retenues.length;
}

const DECLARATION = /* glsl */`
uniform vec3 uLigneA[${MAX_LIGNES}];
uniform vec3 uLigneB[${MAX_LIGNES}];
uniform vec3 uLigneCouleur[${MAX_LIGNES}];
uniform vec3 uLigneFace[${MAX_LIGNES}];
uniform int uLigneNombre;

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

vec3 lignesIrradiance(vec3 P, vec3 N) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGNES}; i++) {
    if (i >= uLigneNombre) break;
    total += irradianceLigne(P, N, uLigneA[i], uLigneB[i], uLigneFace[i], uLigneCouleur[i]);
  }
  return total;
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
    if (Array.isArray(m)) m.forEach(patcherLignes);
    else patcherLignes(m);
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
