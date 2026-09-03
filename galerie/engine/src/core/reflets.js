/**
 * LA SONDE DE RÉFLEXION — les reflets de toute lumière émise, partout.
 *
 * L'image d'environnement (studio neutre pré-filtré, voir
 * environnements.js) donne aux matières leur modelé, mais elle ne sait
 * rien de la salle : un écran de shader, une corniche, une lanterne
 * n'existaient dans aucun reflet — une surface polie en face d'un bandeau
 * de lumière renvoyait un studio gris. Ici, une CAMÉRA CUBIQUE
 * photographie la pièce autour du visiteur, à basse résolution, une face
 * par image ; le cube est pré-filtré (PMREM, comme l'environnement) et
 * s'ajoute dans tous les matériaux standard comme RADIANCE supplémentaire
 * — le reflet spéculaire, flouté selon la rugosité — et, pour une petite
 * part, comme irradiance : la lueur d'une corniche rougit le sol devant
 * elle, la lumière d'une œuvre se voit sur le mur d'en face.
 *
 * Ce que ça n'est pas : une réflexion écran (SSR) exacte — la sonde est
 * prise en UN point, les reflets n'ont pas de parallaxe. Sur des surfaces
 * rugueuses (les nôtres, à 0,6–0,95) c'est invisible ; sur un sol poli,
 * c'est un lavis lumineux qui suit le visiteur, pas un miroir. C'est ce
 * qu'on veut : de la lumière qui se répand, pas un gadget.
 *
 * Coût : un sixième de la pièce à 128 px par image (64 sur mobile, une
 * image sur deux), un PMREM toutes les six faces. `reflets` dans les
 * réglages de la pièce module la force (0 la coupe), `reflets.rebond` la
 * part d'irradiance.
 */
import * as THREE from 'three';

const UNIFORMES = {
  uReflets: { value: null },        // le cube pré-filtré (CubeUV, comme envMap)
  uRefletsForce: { value: 0 },      // part de radiance (reflet)
  uRefletsRebond: { value: 0 }      // part d'irradiance (rebond coloré)
};

export const REFLETS_DEFAUT = { force: 1.0, rebond: 0.22 };

/**
 * LA TAILLE DU CUBE, connue du shader. L'échantillonneur CubeUV de three
 * (`textureCubeUV`) est compilé avec des CONSTANTES tirées de l'image
 * d'environnement de la scène — texel, dernier mip — qui valent pour un
 * cube de 256 (le studio) et pour rien d'autre : lire un cube de 128 avec
 * ces constantes tombe à côté des tuiles, et la sonde ne se voyait NULLE
 * PART (mesuré : différence nulle avec et sans, aux archives). La sonde a
 * donc son propre échantillonneur, copie renommée du chunk de three avec
 * SES constantes. La taille est fixée avant que le premier matériau ne
 * compile (la sonde naît avec l'environnement, voir App).
 */
let TAILLE_SONDE = 128;
// L'ÉCHANTILLONNAGE SIMPLE (téléphone) : un seul niveau de flou par pixel
// au lieu du mélange de deux, et pas de rebond — quatre lectures au lieu
// de seize. Le reflet est flou de toute façon, et le rebond, sur
// téléphone, c'est la sonde d'ambiance qui le porte (ambiance-salle.js).
let SIMPLE = false;
export function reglerTailleSonde(resolution, simple = false) {
  TAILLE_SONDE = resolution;
  SIMPLE = Boolean(simple);
}

/** Le chunk CubeUV de three, renommé et constant pour la taille de la sonde. */
export function echantillonneurGLSL(resolution) {
  // mêmes formules que WebGLProgram (envMapCubeUVSize) pour une hauteur
  // d'image PMREM de 4 × cube
  const maxMip = Math.log2(resolution);
  const texelHeight = 1 / (4 * resolution);
  const texelWidth = 1 / (3 * Math.max(resolution, 7 * 16));
  return THREE.ShaderChunk.cube_uv_reflection_fragment
    .replace(/#ifdef ENVMAP_TYPE_CUBE_UV/, '')
    .replace(/#endif\s*$/, '')
    .replace(/\bgetFace\b/g, 'refletsFace')
    .replace(/\bgetUV\b/g, 'refletsUV')
    .replace(/\bbilinearCubeUV\b/g, 'refletsBilineaire')
    .replace(/\broughnessToMip\b/g, 'refletsMip')
    .replace(/\btextureCubeUV\b/g, 'refletsCubeUV')
    .replace(/\bcubeUV_/g, 'refletsUV_')
    .replace(/\bCUBEUV_MAX_MIP\b/g, maxMip.toFixed(1))
    .replace(/\bCUBEUV_TEXEL_WIDTH\b/g, texelWidth.toFixed(10))
    .replace(/\bCUBEUV_TEXEL_HEIGHT\b/g, texelHeight.toFixed(10))
    // la variante simple : le niveau de flou le plus proche, sans mélange
    + `
vec3 refletsSimple(sampler2D env, vec3 dir, float roughness) {
  float mip = clamp(floor(refletsMip(roughness) + 0.5), refletsUV_m0, ${maxMip.toFixed(1)});
  return refletsBilineaire(env, dir, mip);
}
`;
}

/**
 * Greffe la sonde sur un matériau standard, en préservant un
 * `onBeforeCompile` déjà posé. Idempotent.
 */
export function patcherReflets(material) {
  if (!material || material.userData?.reflets) return material;
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return material;
  material.userData.reflets = true;
  const precedent = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    precedent?.call(material, shader, renderer);
    shader.uniforms.uReflets = UNIFORMES.uReflets;
    shader.uniforms.uRefletsForce = UNIFORMES.uRefletsForce;
    shader.uniforms.uRefletsRebond = UNIFORMES.uRefletsRebond;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uReflets;
uniform float uRefletsForce;
uniform float uRefletsRebond;
${echantillonneurGLSL(TAILLE_SONDE)}`)
      // APRÈS lights_fragment_maps : `radiance` et `iblIrradiance` viennent
      // d'être remplies par l'environnement ; on y ajoute la salle.
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
  if (uRefletsForce > 0.0) {
    vec3 refletsR = reflect(-geometryViewDir, geometryNormal);
    refletsR = inverseTransformDirection(refletsR, viewMatrix);
    radiance += ${SIMPLE ? 'refletsSimple' : 'refletsCubeUV'}(uReflets, refletsR, material.roughness).rgb * uRefletsForce;
    if (uRefletsRebond > 0.0) {
      vec3 refletsN = inverseTransformDirection(geometryNormal, viewMatrix);
      iblIrradiance += PI * refletsCubeUV(uReflets, refletsN, 1.0).rgb * uRefletsRebond;
    }
  }`);
  };
  material.needsUpdate = true;
  return material;
}

/**
 * LE NETTOYAGE D'UNE FACE. La photo brute contient parfois deux ou trois
 * pixels NaN ou infinis (mesuré aux archives et à l'entrée : six
 * composantes sur 16 384 pixels — un point de poussière collé à la caméra,
 * une lampe à bout portant). Le pré-filtrage est une convolution : UN
 * pixel NaN et tout le cube flouté devient NaN, toute la salle noire.
 * Chaque face est donc recopiée par ce shader, qui met ces pixels à zéro
 * et plafonne le reste — une luciole ne doit pas non plus devenir un
 * soleil dans le flou.
 */
const NETTOYAGE = new THREE.ShaderMaterial({
  uniforms: { tBrut: { value: null }, uFace: { value: 0 }, uPlafond: { value: 48 } },
  depthTest: false, depthWrite: false,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform samplerCube tBrut;
    uniform int uFace;
    uniform float uPlafond;
    varying vec2 vUv;
    void main() {
      // la direction qui lit EXACTEMENT ce texel de cette face (convention
      // GL des faces de cube) : une copie à l'identique, en passant par
      // l'échantillonneur
      float s = vUv.x * 2.0 - 1.0, t = vUv.y * 2.0 - 1.0;
      vec3 d;
      if (uFace == 0) d = vec3(1.0, -t, -s);
      else if (uFace == 1) d = vec3(-1.0, -t, s);
      else if (uFace == 2) d = vec3(s, 1.0, t);
      else if (uFace == 3) d = vec3(s, -1.0, -t);
      else if (uFace == 4) d = vec3(s, -t, 1.0);
      else d = vec3(-s, -t, -1.0);
      vec3 c = textureCube(tBrut, d).rgb;
      bvec3 mauvais = bvec3(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b));
      c = mix(c, vec3(0.0), vec3(mauvais));
      gl_FragColor = vec4(clamp(c, vec3(0.0), vec3(uPlafond)), 1.0);
    }`
});

/** Un triangle qui couvre l'écran, pour les passes de copie. */
function triangleEcran(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}
const CAMERA_ECRAN = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class SondeReflets {
  constructor(app, { resolution = 128, cadence = 1, pas = 0, simple = false, rebond = null } = {}) {
    this.app = app;
    this.cadence = Math.max(1, cadence);
    // `rebond` : plafond du rebond diffus (0 sur téléphone, où la sonde
    // d'ambiance le porte déjà) ; null = ce que la pièce demande
    this.rebondMax = Number.isFinite(rebond) ? rebond : null;
    // LA SONDE PARESSEUSE. `pas` > 0 : une fois les six faces prises, la
    // sonde s'endort jusqu'à ce que le visiteur ait marché `pas` mètres
    // (ou changé de salle) — les reflets sont flous, un déplacement d'un
    // mètre ne les change pas à l'œil. À 0 (bureau), elle tourne sans
    // cesse. Sur téléphone, chaque face étant un rendu complet de la
    // salle, c'est la différence entre une sonde qui coûte les deux tiers
    // de l'image et une sonde qui ne coûte rien à l'arrêt.
    this.pas = Math.max(0, pas);
    this._depart = null;       // d'où la photo courante a été prise
    this._salle = null;
    // une puissance de deux : c'est ce que le PMREM garde de toute façon
    resolution = 2 ** Math.floor(Math.log2(Math.max(16, resolution)));
    reglerTailleSonde(resolution, simple);
    const options = {
      type: THREE.HalfFloatType, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
    };
    this.cubeBrut = new THREE.WebGLCubeRenderTarget(resolution, options); // la photo
    this.cube = new THREE.WebGLCubeRenderTarget(resolution, options);     // nettoyée
    this.nettoyeur = triangleEcran(NETTOYAGE);
    this.camera = new THREE.CubeCamera(0.2, 240, this.cubeBrut);
    this.pmrem = new THREE.PMREMGenerator(app.renderer);
    this.pmrem.compileCubemapShader();
    this._face = 0;
    this._tick = 0;
    this._filtre = null;      // la cible PMREM courante
    this._caches = [];
    this.actif = true;
    // avant la première photo, rien : la force reste à zéro tant qu'aucun
    // cube filtré n'existe (l'environnement n'a pas la bonne taille)
    UNIFORMES.uReflets.value = null;
  }

  /** Les réglages de la pièce courante : { force, rebond }, ou coupés. */
  _reglages() {
    const cfg = this.app.rooms?.current?.config;
    const r = cfg?.reflets;
    let reg;
    if (r === false) reg = { force: 0, rebond: 0 };
    else if (typeof r === 'number') reg = { force: r, rebond: REFLETS_DEFAUT.rebond * Math.min(1, r) };
    else reg = { force: r?.force ?? REFLETS_DEFAUT.force, rebond: r?.rebond ?? REFLETS_DEFAUT.rebond };
    if (this.rebondMax !== null) reg.rebond = Math.min(reg.rebond, this.rebondMax);
    return reg;
  }

  /**
   * À appeler chaque image, AVANT le rendu (on emprunte le renderer). Une
   * face du cube par appel ; au bout de six, le cube est pré-filtré et
   * remplace le précédent dans tous les matériaux.
   */
  update() {
    const { force, rebond } = this._reglages();
    if (!this.actif || force <= 0) {
      UNIFORMES.uRefletsForce.value = 0;
      UNIFORMES.uRefletsRebond.value = 0;
      return;
    }
    if (++this._tick % this.cadence) return;
    const r = this.app.renderer;
    const scene = this.app.scene;
    const cam = this.app.camera;
    if (this.pas > 0 && this._face === 0) {
      // entre deux photos : on dort tant qu'on n'a pas marché assez loin
      const salle = this.app.rooms?.current ?? null;
      const loin = !this._depart || salle !== this._salle
        || this._depart.distanceToSquared(cam.position) >= this.pas * this.pas;
      if (!loin) return;
      this._depart = (this._depart ?? new THREE.Vector3()).copy(cam.position);
      this._salle = salle;
    }
    if (this._face === 0) this.photos = (this.photos ?? 0) + 1;   // compteur (sondes, tests)
    // la sonde suit le visiteur — au niveau des yeux, là où sont les reflets
    this.camera.position.copy(cam.position);
    // pendant la photo, la salle ne se reflète pas dans elle-même (une
    // boucle de rebonds), et ce qui refuse une caméra étrangère se cache
    const forceAvant = UNIFORMES.uRefletsForce.value;
    const rebondAvant = UNIFORMES.uRefletsRebond.value;
    UNIFORMES.uRefletsForce.value = 0;
    UNIFORMES.uRefletsRebond.value = 0;
    this._caches.length = 0;
    scene.traverse((o) => {
      if ((o.userData.horsSurvol || o.userData.horsReflets) && o.visible) {
        this._caches.push(o); o.visible = false;
      }
    });
    const cibleAvant = r.getRenderTarget();
    const xrAvant = r.xr.enabled;
    const ombresAvant = r.shadowMap.autoUpdate;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;   // les cartes d'ombre ne se refont pas pour la sonde
    try {
      const cameraFace = this.camera.children[this._face];
      cameraFace.position.copy(this.camera.position);
      cameraFace.updateMatrixWorld(true);
      r.setRenderTarget(this.cubeBrut, this._face);
      r.clear();
      r.render(scene, cameraFace);
      // la copie nettoyée de cette face
      NETTOYAGE.uniforms.tBrut.value = this.cubeBrut.texture;
      NETTOYAGE.uniforms.uFace.value = this._face;
      r.setRenderTarget(this.cube, this._face);
      r.render(this.nettoyeur, CAMERA_ECRAN);
      this._face = (this._face + 1) % 6;
      if (this._face === 0) {
        r.setRenderTarget(cibleAvant);
        const filtre = this.pmrem.fromCubemap(this.cube.texture);
        this._filtre?.dispose();
        this._filtre = filtre;
        UNIFORMES.uReflets.value = filtre.texture;
      }
    } catch (e) {
      console.warn(`[galerie] Reflets : sonde coupée — ${e?.message ?? e}`);
      this.actif = false;
    } finally {
      r.setRenderTarget(cibleAvant);
      r.xr.enabled = xrAvant;
      r.shadowMap.autoUpdate = ombresAvant;
      for (const o of this._caches) o.visible = true;
      this._caches.length = 0;
      UNIFORMES.uRefletsForce.value = this.actif ? (this._filtre ? force : 0) : 0;
      UNIFORMES.uRefletsRebond.value = this.actif ? (this._filtre ? rebond : 0) : 0;
      void forceAvant; void rebondAvant;
    }
  }

  dispose() {
    this._filtre?.dispose();
    this.cube.dispose();
    this.cubeBrut.dispose();
    this.nettoyeur.geometry.dispose();
    this.pmrem.dispose();
  }
}
