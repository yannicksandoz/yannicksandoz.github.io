import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * LE STYLE ARCHITECTURAL — un « mod » activable, pas un fork.
 *
 * `content/reglages.json` :  { "style": "fluide" }
 *
 * Deux styles :
 *
 *   « brut »   — la galerie telle qu'elle a grandi : chambranles en métal
 *                brossé, murs à arêtes franches, masses voxel colorées.
 *
 *   « fluide » — l'esthétique Zaha Hadid des références : coques blanches
 *                continues, ouvertures en anneau adouci, murs dont le
 *                couronnement ondule, masses striées de lignes sombres
 *                (le hall de la Dominion Tower). Le blanc n'est pas un
 *                blanc pur : un blanc de plâtre légèrement froid, qui
 *                prend la couleur des lampes — c'est LUI le matériau.
 *
 * Le style est un réglage GLOBAL lu à la construction des pièces : les
 * bâtisseurs (portails, coques, voxels) le consultent au moment de
 * construire. Le changer dans l'éditeur reconstruit les pièces ; côté
 * visiteur il est fixé au chargement. AUCUN JSON de contenu ne change :
 * le même monde se rend dans les deux styles — c'est ce qui fait du style
 * un mod, et non une migration.
 */

let _style = 'brut';

export function setStyle(nom) {
  _style = nom === 'fluide' ? 'fluide' : 'brut';
}

export function styleCourant() { return _style; }

/** Le monde est-il en mode fluide ? Les bâtisseurs posent LA question. */
export function estFluide() { return _style === 'fluide'; }

/* -------------------------------------------------- la matière du fluide --- */

/**
 * Le blanc structurel du mode fluide — partagé par tous les bâtisseurs
 * pour que portails, couronnements et rubans soient d'une seule coulée.
 * Rugosité basse mais pas nulle : les coques Hadid sont satinées, elles
 * étirent les reflets des lampes sans devenir des miroirs.
 */
export function materiauFluide({ teinte = '#e9e7f0', rugosite = 0.38 } = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(teinte),
    roughness: rugosite,
    metalness: 0.04
  });
}

/**
 * LES STRIES — la signature graphique des références : les lignes sombres
 * parallèles qui suivent la forme (sol de la Dominion Tower, nervures des
 * coques). Patch de shader : des bandes fines le long de l'axe MONDE
 * vertical, adoucies, qui multiplient la couleur — aucun UV requis, donc
 * elles marchent sur les InstancedMesh des voxels comme sur une coque.
 *
 * `pas` : distance entre deux stries (m). `epaisseur` : part sombre de la
 * période (0–1). `force` : combien la strie assombrit.
 */
export function patcherStries(material,
  { pas = 0.5, epaisseur = 0.14, force = 0.55, axe = null, espace = 'monde' } = {}) {
  // `axe` : direction des stries — la phase court LE LONG de cet axe, les
  // bandes lui sont perpendiculaires. Par défaut la verticale du monde.
  // `espace: 'local'` : l'axe se lit dans le repère de L'OBJET (pour un
  // escalier, la diagonale de sa montée) — insensible aux rotations de
  // salle, et l'instance d'un voxel compte dans la grille, pas dans le
  // monde : les stries suivent la forme, c'est toute l'idée.
  const local = espace === 'local';
  const ax = axe ?? [0, 1, 0];
  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uStriePas = { value: pas };
    shader.uniforms.uStrieEpaisseur = { value: epaisseur };
    shader.uniforms.uStrieForce = { value: force };
    shader.uniforms.uStrieAxe = { value: new THREE.Vector3(...ax).normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vStriePos;')
      .replace('#include <project_vertex>', local ? `
        #ifdef USE_INSTANCING
          vStriePos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vStriePos = transformed;
        #endif
        #include <project_vertex>` : `
        #ifdef USE_INSTANCING
          vStriePos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vStriePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uStriePas;
        uniform float uStrieEpaisseur;
        uniform float uStrieForce;
        uniform vec3 uStrieAxe;
        varying vec3 vStriePos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float phase = fract(dot(vStriePos, uStrieAxe) / uStriePas);
          // une strie douce : les bords fondent sur ~1/4 de son épaisseur
          float bord = uStrieEpaisseur * 0.25;
          float strie = smoothstep(0.0, bord, phase)
                      * (1.0 - smoothstep(uStrieEpaisseur - bord, uStrieEpaisseur, phase));
          diffuseColor.rgb *= 1.0 - strie * uStrieForce;
        }`);
  };
  material.customProgramCacheKey =
    () => `stries-${pas}-${epaisseur}-${force}-${ax.join(',')}-${espace}`;
  return material;
}

/* ------------------------------------------------------ courber le volume --- */

/**
 * TESSELER : subdiviser un maillage jusqu'à ce qu'aucune arête ne dépasse
 * `arete` mètres. Indispensable avant toute courbure : les faces extrudées
 * (earcut) n'ont AUCUN sommet intérieur — déplacer les sommets d'un grand
 * mur plat ne courbe que son contour, la surface resterait tendue.
 *
 * La décision de coupe se prend PAR ARÊTE (sa longueur), jamais « la plus
 * longue du triangle » : deux triangles voisins voient la même longueur,
 * donc coupent au même milieu — aucune jonction en T, aucune fissure après
 * déplacement. Les sommets sont d'abord soudés (position + normale + UV) :
 * les arêtes vives restent doublées, computeVertexNormals les respectera.
 * Fonction pure — la suite de tests la conduit sans WebGL.
 */
export function tesseler(geometry, arete = 1.4) {
  const g = geometry.index ? geometry : mergeVertices(geometry, 1e-4);
  g.clearGroups();
  const pos = Array.from(g.attributes.position.array);
  const uv = g.attributes.uv ? Array.from(g.attributes.uv.array) : null;
  let tris = Array.from(g.index.array);
  const l2max = arete * arete;
  const milieux = new Map();
  const long2 = (a, b) => {
    const dx = pos[3 * a] - pos[3 * b];
    const dy = pos[3 * a + 1] - pos[3 * b + 1];
    const dz = pos[3 * a + 2] - pos[3 * b + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const milieu = (a, b) => {
    const cle = a < b ? a * 1e7 + b : b * 1e7 + a;
    let m = milieux.get(cle);
    if (m !== undefined) return m;
    m = pos.length / 3;
    pos.push((pos[3 * a] + pos[3 * b]) / 2,
      (pos[3 * a + 1] + pos[3 * b + 1]) / 2,
      (pos[3 * a + 2] + pos[3 * b + 2]) / 2);
    if (uv) uv.push((uv[2 * a] + uv[2 * b]) / 2, (uv[2 * a + 1] + uv[2 * b + 1]) / 2);
    milieux.set(cle, m);
    return m;
  };
  for (let passe = 0; passe < 24; passe++) {
    const sortie = [];
    let coupe = false;
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const lab = long2(a, b) > l2max, lbc = long2(b, c) > l2max, lca = long2(c, a) > l2max;
      const n = (lab ? 1 : 0) + (lbc ? 1 : 0) + (lca ? 1 : 0);
      if (!n) { sortie.push(a, b, c); continue; }
      coupe = true;
      if (n === 3) {
        const mab = milieu(a, b), mbc = milieu(b, c), mca = milieu(c, a);
        sortie.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
      } else if (n === 2) {
        // faire tourner pour que les deux longues soient ab et bc
        let A = a, B = b, C = c, ab = lab, bc = lbc;
        if (!ab) { A = b; B = c; C = a; ab = lbc; bc = lca; }
        else if (!bc) { A = c; B = a; C = b; ab = lca; bc = lab; }
        const m1 = milieu(A, B), m2 = milieu(B, C);
        sortie.push(A, m1, C, m1, B, m2, m1, m2, C);
      } else {
        let A = a, B = b, C = c;
        if (lbc) { A = b; B = c; C = a; }
        else if (lca) { A = c; B = a; C = b; }
        const m = milieu(A, B);
        sortie.push(A, m, C, m, B, C);
      }
    }
    tris = sortie;
    if (!coupe) break;
  }
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) fin.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fin.setIndex(tris);
  return fin;
}

/**
 * COURBER UNE PAROI : le mur cesse d'être un plan. Déplacement des sommets
 * le long de la normale du mur (son axe local z) :
 *
 *   f(x, y) = A · sin(πt) · profil(y) · ondulation(t) · masque_baies(x)
 *
 * — sin(πt) : les EXTRÉMITÉS ne bougent pas, les angles des murs voisins
 *   se rejoignent exactement comme avant ;
 * — profil(y) : pièce à ciel ouvert, le voile s'évase vers le sommet
 *   (y^1.5) ; pièce couverte, il prend du VENTRE (sin πy) et revient
 *   affleurer le plafond — pas de jour sous la verrière ;
 * — ondulation : la même respiration que le couronnement, semée par la
 *   longueur — deux murs ne se courbent jamais pareil ;
 * — masque_baies : autour de chaque baie la courbure fond vers zéro, la
 *   bande reste PLANE — chambranles, vitres invisibles et portails posent
 *   affleurants, rien ne flotte.
 *
 * La collision suit gratuitement : la coque bloque la marche par son
 * maillage de rendu. Renvoie une NOUVELLE géométrie (tesselée).
 */
export function courberParoi(geometry, {
  length, height, sink = 0, zones = [], plafonne = false, sens = 1,
  amplitude = null, arete = 1.4
} = {}) {
  const g = tesseler(geometry, arete);
  const loi = loiParoi({ length, height, sink, zones, plafonne, amplitude });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const f = loi(pos.getX(i), pos.getY(i));
    if (f) pos.setZ(i, pos.getZ(i) + sens * f);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * LA LOI DU VOILE, seule : (x, y) → flèche non signée, dans le repère du
 * mur (x le long, centré ; y la hauteur). C'est la même fonction que suit
 * courberParoi — exportée pour que tout ce qui S'ACCROCHE au mur (une
 * corniche lumineuse, demain une plinthe) épouse exactement sa courbe au
 * lieu de flotter devant. Fonction pure, sans géométrie.
 */
export function loiParoi({
  length, height, sink = 0, zones = [], plafonne = false, amplitude = null
} = {}) {
  const A = amplitude ?? Math.min(0.55, length * 0.03);
  const phase = (length * 4.71) % (Math.PI * 2);
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (x + length / 2) / length));
    const yn = Math.min(1, Math.max(0, (y + sink) / (height + sink)));
    const profil = plafonne ? Math.sin(Math.PI * yn) : Math.pow(yn, 1.5);
    const onde = 0.6 + 0.4 * Math.sin(Math.PI * 2 * 1.3 * t + phase);
    let f = A * Math.sin(Math.PI * t) * profil * onde;
    for (const [za, zb] of zones) f *= masqueZone(x, za, zb);
    return f;
  };
}

/** 0 dans [a, b], 1 au-delà de la marge, fondu C¹ entre les deux. */
function masqueZone(x, a, b, marge = 0.7) {
  if (x >= a && x <= b) return 0;
  const d = x < a ? a - x : x - b;
  if (d >= marge) return 1;
  const u = d / marge;
  return u * u * (3 - 2 * u);
}

/**
 * SERPENTER UN VOLUME VOXEL : une masse gravissable (escalier, rampe) cesse
 * d'être une barre orthogonale — elle ondoie en plan (S doux, extrémités
 * FIXES pour que les connexions du labyrinthe tiennent) et GONFLE en son
 * milieu (la forme change, pas seulement la ligne). Ne s'applique qu'aux
 * masses nettement allongées : un palier carré, une sculpture compacte
 * restent ce qu'ils sont. Renvoie null hors mode fluide ou si la masse
 * n'est pas allongée ; sinon { axe, decalage(t), gonflement(t) } où t est
 * la progression le long de l'axe long. Le rendu fusionné ET le collider
 * appliquent LA MÊME loi — la marche reste exactement sur la forme.
 */
export function serpentinVoxel(dims, cell) {
  if (!estFluide()) return null;
  const lx = dims[0] * cell, lz = dims[2] * cell;
  const long = Math.max(lx, lz), larg = Math.min(lx, lz);
  if (long < 5 || long < larg * 2.2) return null;
  const axe = lx >= lz ? 0 : 2;
  // L'AMPLITUDE SE PREND SUR LA LONGUEUR, plus sur la largeur : une volée
  // étroite ne doit pas se contenter d'un frisson de dix centimètres. Elle
  // reste bornée par sa propre largeur — c'est ce qui garantit qu'une
  // marche recouvre encore largement la précédente : le décalage latéral
  // d'un pas au suivant vaut au pire A·8,3/nombre de marches, soit un
  // cinquième de la largeur pour une volée de trente marches.
  const A = Math.min(long * 0.17, larg * 0.7);
  const phase = ((dims[0] * 3 + dims[1] * 5 + dims[2] * 7) % 13) / 13 * Math.PI * 2;
  // DEUX ONDES plutôt qu'une : la porteuse donne le grand S, l'harmonique
  // le repentir en son milieu — une vraie sinuosité, pas un arc. L'enveloppe
  // sin(π t) s'annule aux deux bouts : les extrémités de la volée ne bougent
  // pas d'un millimètre, et les connexions du labyrinthe tiennent.
  // TROIS lobes : gauche, droite, gauche. Une porteuse à deux lobes ne
  // faisait qu'un S — un arc, pas un serpent ; il faut au moins trois
  // ventres pour que le regard lise une sinuosité en montant.
  const forme = (t) => Math.sin(Math.PI * t) * (
    0.70 * Math.sin(Math.PI * 3 * t + phase)
    + 0.32 * Math.sin(Math.PI * 5 * t + 1.6 * phase));
  // Le maximum du couple dépend de la phase : on le RELÈVE une fois pour
  // toutes plutôt que de le supposer. Sans ça, l'amplitude réelle valait
  // selon la volée la moitié ou les trois quarts de celle qu'on croyait
  // demander, et deux escaliers voisins ondulaient inégalement.
  let crete = 0;
  for (let i = 0; i <= 240; i++) crete = Math.max(crete, Math.abs(forme(i / 240)));
  const g = crete > 1e-6 ? A / crete : 0;
  return {
    axe,
    decalage: (t) => g * forme(t),
    gonflement: (t) => 1 + 0.34 * Math.sin(Math.PI * t)
  };
}

/* ------------------------------------------------------- le couronnement --- */

/**
 * Dessine le sommet FLUIDE d'un mur dans une Shape en cours : un voile qui
 * s'affaisse en douceur entre ses extrémités, celles-ci gardant la pleine
 * hauteur pour recevoir les angles. Appelé par `murPerce` quand le style
 * est fluide ET que la coque n'a pas de plafond. Fonction pure : la suite
 * de tests la conduit sans WebGL ni DOM.
 *
 * La forme arrive au point (length/2, hauteur-…) : on trace de droite à
 * gauche. Le creux est relatif — 12 % de la hauteur, plafonné à 1,20 m.
 */
/**
 * LA LOI DU COURONNEMENT, seule : x (le long du mur, centré) → de combien
 * le sommet est DESCENDU à cet endroit, en mètres (0 aux extrémités).
 *
 * Exportée pour la même raison que loiParoi : ce qui s'accroche au haut
 * d'un mur — une corniche lumineuse — doit suivre l'ondulation au lieu de
 * la traverser. Une seule loi, deux usages : dessinerCouronne la trace,
 * Artwork.courberCorniche la suit.
 */
export function loiCouronne({ length, height }) {
  // PLUS PROFILÉ, PLUS SINUEUX. Une porteuse de 2,2 périodes sur soixante
  // mètres de mur donne une longueur d'onde de vingt-sept mètres : de face,
  // la ligne se relit comme un seul affaissement mou, à peine ridé. Trois
  // périodes et demie, une harmonique par-dessus, et le double d'amplitude :
  // le sommet monte et redescend plusieurs fois sur la longueur — c'est un
  // profil, plus une pente.
  const A = Math.min(height * 0.24, 2.4);
  const phase = (length * 7.13) % (Math.PI * 2);
  // Le creux reste POSITIF partout (0,62 − 0,38 − 0,18 = 0,06) : la ligne
  // ne remonte jamais au-dessus du sommet nominal, où les angles des murs
  // voisins l'attendent. L'enveloppe sin(π t) l'annule aux deux bouts.
  const forme = (t) => Math.sin(Math.PI * t) * (
    0.62
    + 0.38 * Math.sin(Math.PI * 2 * 3.4 * t + phase)
    + 0.18 * Math.sin(Math.PI * 2 * 6.1 * t + 1.4 * phase));
  // on RELÈVE la crête plutôt que de la supposer : elle dépend de la phase,
  // donc de la longueur du mur, et deux murs voisins doivent creuser autant
  let crete = 0;
  for (let i = 0; i <= 240; i++) crete = Math.max(crete, forme(i / 240));
  const g = crete > 1e-6 ? A / crete : 0;
  return (x) => {
    // la forme se trace de DROITE à gauche : t = 0 au bord +length/2
    const t = Math.min(1, Math.max(0, (length / 2 - x) / length));
    return g * forme(t);
  };
}

export function dessinerCouronne(forme, length, height, segments = 48) {
  // L'ONDULATION, pas l'affaissement. La première version était UNE arche
  // en creux : de loin, elle se relisait comme une droite qui plonge un
  // peu. La ligne des références ne repose jamais — elle ondule. D'où une
  // PORTEUSE de ~2,2 périodes modulée par une enveloppe sin(πt) : les
  // extrémités restent exactement à pleine hauteur (les angles des murs
  // voisins se rejoignent), et TOUT l'intérieur vit — le facteur de la
  // porteuse reste dans [0,3 ; 1], donc la ligne ne retouche jamais le
  // sommet et ne descend jamais sous l'amplitude prévue.
  //
  // La phase est SEMÉE PAR LA LONGUEUR du mur : deux murs différents
  // ondulent différemment, le même mur ondule pareil à chaque build.
  const creux = loiCouronne({ length, height });
  forme.lineTo(length / 2, height);
  for (let i = 1; i <= segments; i++) {
    const x = length / 2 - (i / segments) * length;
    forme.lineTo(x, height - creux(x));
  }
  return forme;
}
