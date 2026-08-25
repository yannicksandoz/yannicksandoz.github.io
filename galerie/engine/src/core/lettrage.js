/**
 * LE LETTRAGE — les lettres dessinées depuis leurs CONTOURS, au pixel près.
 *
 * Portage de l'algorithme **Slug** d'Eric Lengyel :
 *   • le papier — « GPU-Centered Font Rendering Directly from Glyph
 *     Outlines », Journal of Computer Graphics Techniques 6(2), 2017,
 *     https://jcgt.org/published/0006/02/02/ ;
 *   • les shaders de référence — https://github.com/EricLengyel/Slug
 *     (SlugPixelShader.hlsl, SlugVertexShader.hlsl), licence MIT OU
 *     Apache-2.0, brevet versé au domaine public. LE CRÉDIT EST EXIGÉ par
 *     l'auteur, et le voici : Slug shader code Copyright 2017 by Eric
 *     Lengyel.
 *
 * CE QUE ÇA CHANGE PAR RAPPORT AU SDF. Un champ de distances est un
 * ÉCHANTILLONNAGE : à 64 pixels par em, les coins s'arrondissent et les
 * jonctions fines bavent quand on colle le nez dessus. Slug ne stocke pas
 * des pixels mais LES COURBES ELLES-MÊMES : chaque fragment résout les
 * polynômes des Béziers quadratiques qui le concernent et en tire une
 * couverture analytique — deux rayons, un horizontal, un vertical,
 * pondérés. Le trait est exact à TOUT grossissement, l'anticrénelage tient
 * dans la formule (saturate(x + ½) : la fraction du pixel couverte), et il
 * n'y a ni atlas, ni worker, ni recalcul quand le texte change d'échelle.
 *
 * Les bandes : chaque glyphe découpe son em en tranches horizontales et
 * verticales, et chaque tranche liste les seules courbes qu'un rayon parti
 * d'elle peut croiser, triées pour l'ARRÊT ANTICIPÉ (dès qu'une courbe est
 * toute à gauche du pixel, les suivantes aussi). C'est l'invention centrale
 * de Slug, celle qui borne le coût du pixel.
 *
 * DEUX ÉCARTS assumés à la référence, documentés parce qu'un lecteur du
 * .hlsl d'origine les cherchera :
 *   • pas de DILATATION dynamique (SlugDilate) : la référence agrandit le
 *     quadrilatère d'un demi-pixel écran pour que l'anticrénelage ne soit
 *     jamais rogné. On PADDE statiquement la boîte de 0,25 em — un cartel
 *     n'est jamais lisible en dessous de quelques pixels, et un quart d'em
 *     y couvre largement le demi-pixel ;
 *   • les textures sont en float32 (la référence : float16 et uint16). Les
 *     entiers de bandes tiennent exactement dans un float32, et un seul
 *     type de sampler évite un chemin de texture entière que certains
 *     pilotes servent mal.
 *
 * Les DONNÉES viennent de `lettrage-inter.js` (généré depuis l'Inter du
 * dépôt — voir `genere-lettrage.mjs`), l'emballage de
 * `lettrage-reglages.js`, ÉPROUVÉ au nœud contre deux oracles avant
 * d'arriver ici. Ce fichier ne décide rien : il téléverse et dessine.
 */
import * as THREE from 'three';
import { LETTRAGE } from './lettrage-inter.js';
import { emballerGlyphes, poserTexte, LARGEUR_TEXTURE, couvertureCPU }
  from './lettrage-reglages.js';

// Pour les sondes de test : la référence CPU et les données, afin de
// comparer les pixels du GPU à ce que l'algorithme DOIT rendre.
export { couvertureCPU, LETTRAGE };

/** Le padding des quadrilatères, en em — voir l'écart n° 1 ci-dessus. */
const MARGE_EM = 0.25;

const VERTEX = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTaille;               // hauteur d'un em, en mètres
in vec3 position;                    // coin du quadrilatère, dans [0,1]²
in vec4 aBoite;                      // boîte du glyphe, paddée (em)
in vec2 aPose;                       // origine du glyphe dans le texte (em)
in vec2 aLoc;                        // adresse du glyphe en texture de bandes
in vec2 aMax;                        // (bandes verticales − 1, horizontales − 1)
in vec4 aTransfo;                    // échelle et décalage → indice de bande
out vec2 vCoord;                     // coordonnées d'échantillon, en em
flat out ivec2 vLoc;
flat out ivec2 vMax;
flat out vec4 vTransfo;

void main() {
  vec2 em = mix(aBoite.xy, aBoite.zw, position.xy);
  vCoord = em;
  vLoc = ivec2(aLoc + 0.5);
  vMax = ivec2(aMax + 0.5);
  vTransfo = aTransfo;
  vec2 local = (aPose + em) * uTaille;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uCourbes;          // [x1 y1 x2 y2][x3 y3 · ·], em
uniform sampler2D uBandes;           // en-têtes (nombre, décalage) puis listes
uniform vec3 uCouleur;
uniform float uOpacite;
in vec2 vCoord;
flat in ivec2 vLoc;
flat in ivec2 vMax;
flat in vec4 vTransfo;
out vec4 sortie;

// La table d'éligibilité des racines — le CalcRootCode de Lengyel : les
// signes des trois ordonnées forment trois bits, et 0x2E74 dit lesquelles
// des deux racines comptent dans l'enroulement. C'est elle qui rend les
// extrémités posées PILE sur le rayon inoffensives.
uint calcCode(float y1, float y2, float y3) {
  uint i1 = floatBitsToUint(y1) >> 31u;
  uint i2 = floatBitsToUint(y2) >> 30u;
  uint i3 = floatBitsToUint(y3) >> 29u;
  uint decal = (i3 & 4u) | (i2 & 2u) | (i1 & 1u);
  return (0x2E74u >> decal) & 0x0101u;
}

// Les x où la courbe (relative à l'échantillon) croise y = 0 — le
// SolveHorizPoly de Lengyel, discriminant borné à zéro, repli linéaire
// quand le terme carré s'évanouit. Pour l'axe vertical, on l'appelle avec
// les composantes échangées.
vec2 resoudre(vec4 p12, vec2 p3) {
  vec2 a = p12.xy - p12.zw * 2.0 + p3;
  vec2 b = p12.xy - p12.zw;
  float ra = 1.0 / a.y;
  float rb = 0.5 / b.y;
  float d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
  float t1 = (b.y - d) * ra;
  float t2 = (b.y + d) * ra;
  if (abs(a.y) < 1.0 / 65536.0) { t1 = p12.y * rb; t2 = t1; }
  return vec2((a.x * t1 - b.x * 2.0) * t1 + p12.x,
              (a.x * t2 - b.x * 2.0) * t2 + p12.x);
}

// L'adressage replié des listes de bandes — le CalcBandLoc de Lengyel,
// largeur de texture 4096.
ivec2 adresseBande(ivec2 glyphe, int decalage) {
  ivec2 l = ivec2(glyphe.x + decalage, glyphe.y);
  l.y += l.x >> 12;
  l.x &= 4095;
  return l;
}

void main() {
  vec2 emParPixel = fwidth(vCoord);
  vec2 pixelsParEm = 1.0 / emParPixel;

  // dans quelles bandes ce pixel vit : échelle + décalage, puis borne
  ivec2 bande = clamp(ivec2(vCoord * vTransfo.xy + vTransfo.zw),
    ivec2(0), vMax);

  float xcov = 0.0, xwgt = 0.0;

  // la bande HORIZONTALE : en-tête à glyphe.x + indice, sans repli
  vec2 hTete = texelFetch(uBandes, ivec2(vLoc.x + bande.y, vLoc.y), 0).xy;
  ivec2 hListe = adresseBande(vLoc, int(hTete.y + 0.5));
  int hNombre = int(hTete.x + 0.5);
  for (int i = 0; i < hNombre; i++) {
    ivec2 ou = adresseBande(hListe, i);
    ivec2 courbe = ivec2(texelFetch(uBandes, ou, 0).xy + 0.5);
    vec4 p12 = texelFetch(uCourbes, courbe, 0) - vCoord.xyxy;
    vec2 p3 = texelFetch(uCourbes, ivec2(courbe.x + 1, courbe.y), 0).xy - vCoord;
    // les courbes sont triées par x maximal décroissant : dès que l'une est
    // toute à gauche du pixel, les suivantes aussi — l'arrêt anticipé
    if (max(max(p12.x, p12.z), p3.x) * pixelsParEm.x < -0.5) break;
    uint code = calcCode(p12.y, p12.w, p3.y);
    if (code != 0u) {
      vec2 r = resoudre(p12, p3) * pixelsParEm.x;
      if ((code & 1u) != 0u) {
        xcov += clamp(r.x + 0.5, 0.0, 1.0);
        xwgt = max(xwgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
      }
      if (code > 1u) {
        xcov -= clamp(r.y + 0.5, 0.0, 1.0);
        xwgt = max(xwgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
      }
    }
  }

  float ycov = 0.0, ywgt = 0.0;

  // la bande VERTICALE : ses en-têtes suivent les horizontales
  vec2 vTete = texelFetch(uBandes,
    ivec2(vLoc.x + vMax.y + 1 + bande.x, vLoc.y), 0).xy;
  ivec2 vListe = adresseBande(vLoc, int(vTete.y + 0.5));
  int vNombre = int(vTete.x + 0.5);
  for (int i = 0; i < vNombre; i++) {
    ivec2 ou = adresseBande(vListe, i);
    ivec2 courbe = ivec2(texelFetch(uBandes, ou, 0).xy + 0.5);
    vec4 p12 = texelFetch(uCourbes, courbe, 0) - vCoord.xyxy;
    vec2 p3 = texelFetch(uCourbes, ivec2(courbe.x + 1, courbe.y), 0).xy - vCoord;
    if (max(max(p12.y, p12.w), p3.y) * pixelsParEm.y < -0.5) break;
    uint code = calcCode(p12.x, p12.z, p3.x);
    if (code != 0u) {
      vec2 r = resoudre(p12.yxwz, p3.yx) * pixelsParEm.y;
      // les signes s'inversent : échanger les axes retourne l'enroulement
      if ((code & 1u) != 0u) {
        ycov -= clamp(r.x + 0.5, 0.0, 1.0);
        ywgt = max(ywgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
      }
      if (code > 1u) {
        ycov += clamp(r.y + 0.5, 0.0, 1.0);
        ywgt = max(ywgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
      }
    }
  }

  // la combinaison pondérée des deux rayons — le CalcCoverage de Lengyel,
  // règle d'enroulement non nulle, valeurs absolues pour accepter les deux
  // conventions de sens
  float couverture = max(
    abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0),
    min(abs(xcov), abs(ycov)));
  couverture = clamp(couverture, 0.0, 1.0);

  sortie = vec4(uCouleur, couverture * uOpacite);
  if (sortie.a < 0.001) discard;
}
`;

/* ------------------------------------------------- les données, une fois -- */

let _partage = null;

/** Textures et mesures partagées, bâties au premier usage (ou par chauffer). */
function partage() {
  if (_partage) return _partage;
  const upm = LETTRAGE.upm;

  // les formes en em, emballées par le MÊME code que celui des tests
  const jeu = new Map();
  for (const [id, plat] of Object.entries(LETTRAGE.formes)) {
    const courbes = [];
    for (let i = 0; i < plat.length; i += 6) {
      courbes.push([plat[i] / upm, plat[i + 1] / upm, plat[i + 2] / upm,
        plat[i + 3] / upm, plat[i + 4] / upm, plat[i + 5] / upm]);
    }
    jeu.set(id, { courbes });
  }
  const e = emballerGlyphes(jeu);

  const courbes = new Float32Array(LARGEUR_TEXTURE * e.lignesC * 4);
  courbes.set(e.courbes);
  const texCourbes = new THREE.DataTexture(courbes, LARGEUR_TEXTURE, e.lignesC,
    THREE.RGBAFormat, THREE.FloatType);
  texCourbes.minFilter = texCourbes.magFilter = THREE.NearestFilter;
  texCourbes.generateMipmaps = false;
  texCourbes.needsUpdate = true;

  // les entiers de bandes, en float32 : exacts jusqu'à 2^24, on est à 4096
  const bandes = new Float32Array(LARGEUR_TEXTURE * e.lignesB * 2);
  bandes.set(e.bandes);
  const texBandes = new THREE.DataTexture(bandes, LARGEUR_TEXTURE, e.lignesB,
    THREE.RGFormat, THREE.FloatType);
  texBandes.minFilter = texBandes.magFilter = THREE.NearestFilter;
  texBandes.generateMipmaps = false;
  texBandes.needsUpdate = true;

  const mesures = {
    avance: (c) => (LETTRAGE.glyphes[c]?.avance ?? 0) / upm,
    crenage: (a, b) => (LETTRAGE.crenage[a + b] ?? 0) / upm,
    ascendant: LETTRAGE.metriques.ascendant / upm,
    descendant: LETTRAGE.metriques.descendant / upm
  };
  _partage = { texCourbes, texBandes, infos: e.infos, mesures };
  return _partage;
}

/** Prépare textures et emballage d'avance — à l'ouverture de la galerie. */
export function chaufferLettrage() {
  partage();
  return true;
}

/* --------------------------------------------------------- le maillage -- */

const COIN = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
const COIN_INDEX = [0, 1, 2, 0, 2, 3];

/**
 * Remplit (ou re-remplit) la géométrie instanciée d'un texte posé.
 * Un glyphe = une instance ; l'espace, qui n'a pas de forme, n'en émet pas.
 */
function poserInstances(geometrie, texte, options) {
  const { infos, mesures } = partage();
  const pose = poserTexte(texte, mesures, options);

  const places = pose.glyphes.filter((g) => {
    const forme = LETTRAGE.glyphes[g.cle]?.forme;
    return forme !== undefined && infos.get(String(forme))?.boite
      && LETTRAGE.formes[forme].length > 0;
  });
  const n = places.length;
  const aBoite = new Float32Array(n * 4);
  const aPose = new Float32Array(n * 2);
  const aLoc = new Float32Array(n * 2);
  const aMax = new Float32Array(n * 2);
  const aTransfo = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const g = places[i];
    const info = infos.get(String(LETTRAGE.glyphes[g.cle].forme));
    const [x0, y0, x1, y1] = info.boite;
    aBoite.set([x0 - MARGE_EM, y0 - MARGE_EM, x1 + MARGE_EM, y1 + MARGE_EM], i * 4);
    aPose.set([g.x, g.y], i * 2);
    aLoc.set(info.loc, i * 2);
    aMax.set(info.bandesMax, i * 2);
    aTransfo.set(info.transformation, i * 4);
  }
  geometrie.setAttribute('aBoite', new THREE.InstancedBufferAttribute(aBoite, 4));
  geometrie.setAttribute('aPose', new THREE.InstancedBufferAttribute(aPose, 2));
  geometrie.setAttribute('aLoc', new THREE.InstancedBufferAttribute(aLoc, 2));
  geometrie.setAttribute('aMax', new THREE.InstancedBufferAttribute(aMax, 2));
  geometrie.setAttribute('aTransfo', new THREE.InstancedBufferAttribute(aTransfo, 4));
  geometrie.instanceCount = n;
  return pose;
}

/**
 * Un texte posé dans la scène : UN maillage, UN appel de dessin, quel que
 * soit le nombre de lettres. `taille` est la hauteur d'un em en mètres.
 */
export function creerLettres({
  texte = '', taille = 0.26, couleur = 0xffffff, opacite = 1,
  largeurMax = Infinity, interligne = 1.25,
  ancrageX = 'center', ancrageY = 'middle'
} = {}) {
  const p = partage();
  const geometrie = new THREE.InstancedBufferGeometry();
  geometrie.setAttribute('position', new THREE.BufferAttribute(COIN, 3));
  geometrie.setIndex(COIN_INDEX);
  const options = { largeurMax: largeurMax / taille, interligne, ancrageX, ancrageY };
  const pose = poserInstances(geometrie, texte, options);

  const materiau = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uCourbes: { value: p.texCourbes },
      uBandes: { value: p.texBandes },
      uTaille: { value: taille },
      uCouleur: { value: new THREE.Color(couleur) },
      uOpacite: { value: opacite }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const maille = new THREE.Mesh(geometrie, materiau);
  // la sphère englobante d'une géométrie instanciée ne se déduit pas des
  // attributs : on la pose depuis la mise en page, généreusement
  const rayon = (Math.max(pose.largeur, pose.hauteur) / 2 + 1) * taille;
  geometrie.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), rayon);
  maille.renderOrder = 10;
  maille.raycast = () => {};           // jamais une cible de clic
  maille.userData.lettrage = { texte, taille, options };
  return maille;
}

/** Change texte, couleur ou opacité — ne repose que si le texte a bougé. */
export function majLettres(maille, { texte, couleur, opacite } = {}) {
  const etat = maille?.userData?.lettrage;
  if (!etat) return false;
  let bouge = false;
  if (texte !== undefined && texte !== etat.texte) {
    etat.texte = texte;
    const pose = poserInstances(maille.geometry, texte, etat.options);
    const rayon = (Math.max(pose.largeur, pose.hauteur) / 2 + 1) * etat.taille;
    maille.geometry.boundingSphere.radius = rayon;
    bouge = true;
  }
  if (couleur !== undefined) maille.material.uniforms.uCouleur.value.set(couleur);
  if (opacite !== undefined) maille.material.uniforms.uOpacite.value = opacite;
  return bouge;
}

/** Rend géométrie et matériau ; les textures partagées restent en vie. */
export function disposerLettres(maille) {
  if (!maille) return;
  maille.parent?.remove(maille);
  maille.geometry?.dispose();
  maille.material?.dispose();
}
