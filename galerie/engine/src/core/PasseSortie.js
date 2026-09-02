import {
  Color, ColorManagement, RawShaderMaterial, UniformsUtils, Vector2,
  LinearToneMapping, ReinhardToneMapping, CineonToneMapping,
  AgXToneMapping, ACESFilmicToneMapping, NeutralToneMapping, SRGBTransfer
} from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * LA SORTIE, EN UNE SEULE PASSE.
 *
 * Mesuré au belvédère sous profil mobile : la trame ne tient plus aux
 * appels de dessin (49 par image, six mille triangles) mais au PIXEL —
 * tout le temps part dans le fragment. Or la chaîne de post-traitement
 * relisait puis réécrivait l'image ENTIÈRE trois fois de suite :
 *
 *   1. le bloom mélangeait sa fleur, en additif, dans le tampon de lecture ;
 *   2. `OutputPass` relisait ce tampon pour la courbe de tons et le sRGB ;
 *   3. la passe de grain relisait ENCORE — et trois fois par pixel, puisque
 *      l'aberration chromatique écarte le rouge et le bleu.
 *
 * Trois allers-retours pleine résolution pour trois opérations qui tiennent
 * chacune en quelques lignes. Sur un GPU de téléphone — architecture à
 * tuiles — chaque passe plein écran coûte le chargement ET le rangement de
 * la tuile complète : c'est la bande passante, pas le calcul, qui paie.
 *
 * On les réunit donc : un seul quad plein écran lit la scène (trois taps
 * pour l'aberration), y ajoute la fleur du bloom, applique la courbe de
 * tons, encode en sRGB, pose le grain et le vignettage. Le résultat est le
 * même image pour image ; il coûte un tiers du chemin.
 *
 * Le bloom n'est plus une passe du composer : il devient un OUTIL que la
 * sortie appelle pour se faire calculer sa fleur (pyramide de flous en
 * basse résolution, elle, inchangée). Il garde donc son réglage, son
 * budget et sa coupure par le gouverneur de qualité.
 */

/* --------------------------------------------------------------- fleur --- */

/**
 * Le bloom d'Unreal, arrêté juste avant son mélange final.
 *
 * `UnrealBloomPass.render` fait quatre choses : extraire les hautes
 * lumières, flouter la pyramide, composer les niveaux, puis MÉLANGER le
 * tout dans le tampon de lecture. C'est ce dernier geste — le seul qui
 * travaille en pleine résolution — que la sortie reprend à son compte.
 */
export class BloomFleur extends UnrealBloomPass {
  /**
   * L'ÉCHELLE DE LA PYRAMIDE, enfin respectée.
   *
   * `bloomResScale` du profil de qualité (0,25 sur mobile) ne servait à
   * rien : il ne passait que par le vecteur de résolution du constructeur,
   * et `UnrealBloomPass.setSize` — appelé par le composer au premier
   * dimensionnement, puis à chaque redimensionnement — l'écrasait par
   * `largeur / 2` en pixels d'ÉCRAN. La pyramide tournait donc à la moitié
   * de la résolution physique : 292 × 633 sur un iPhone à densité 1,5, là
   * où le profil demandait 97 × 211. Neuf fois trop de pixels, à chaque
   * image, pour un flou dont c'est justement le métier de tout perdre.
   */
  setSize(width, height) {
    const e = this.echelle ?? 0.5;
    // le parent divise par deux : on lui donne le double de ce qu'on veut
    super.setSize(Math.max(2, Math.round(width * e * 2)),
      Math.max(2, Math.round(height * e * 2)));
  }

  /**
   * Calcule la fleur à partir d'une cible de rendu, sans rien y réécrire.
   * Renvoie la texture à ajouter (déjà multipliée par `strength`).
   */
  calculerFleur(renderer, source) {
    const clearCouleur = renderer.getClearColor(this._oldClearColor).clone();
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // 1. les hautes lumières
    this.highPassUniforms.tDiffuse.value = source.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. la pyramide de flous
    let entree = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const flou = this.separableBlurMaterials[i];
      this.fsQuad.material = flou;
      flou.uniforms.colorTexture.value = entree.texture;
      flou.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      flou.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      flou.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      entree = this.renderTargetsVertical[i];
    }

    // 3. la composition des niveaux
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(clearCouleur, clearAlpha);
    renderer.autoClear = autoClear;
    return this.renderTargetsHorizontal[0].texture;
  }
}

/* --------------------------------------------------------------- shader --- */

const SORTIE = {
  name: 'PasseSortie',
  uniforms: {
    tDiffuse: { value: null },
    tFleur: { value: null },
    uFleur: { value: 1 },        // 0 = bloom coupé (gouverneur de qualité)
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },    // 0 = grain coupé
    uVignette: { value: 0.4 },
    uAberration: { value: 0.006 },
    // LE SURVOL (voir Survol.js) : masque de silhouette de l'œuvre visée,
    // dilaté ici en liseré. `uContour` = force du liseré (0 : rien à faire)
    tMasque: { value: null },      // la silhouette, nette
    tMasqueFlou: { value: null },  // la même, floutée (Survol.js)
    uContour: { value: 0 },
    uContourCouleur: { value: new Color(0xffffff) } // blanc : un trait, pas une teinte
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tFleur;
    uniform float uFleur, uTime, uGrain, uVignette, uAberration;
    uniform sampler2D tMasque, tMasqueFlou;
    uniform float uContour;
    uniform vec3 uContourCouleur;
    varying vec2 vUv;

    // LE LISERÉ DU SURVOL : ce que le masque FLOUTÉ déborde du masque net
    // (Survol.js fait le flou, gaussien, à demi-résolution). Au ras de la
    // silhouette le flou vaut un demi et retombe en douceur vers l'extérieur ;
    // dedans, le masque net l'annule. Deux lectures, un dégradé continu —
    // et seulement quand une œuvre est visée (la branche est uniforme, le
    // GPU la saute vraiment). Le ×2 ramène le ras de la silhouette au plein.
    float contour(vec2 uv) {
      float flou = texture2D(tMasqueFlou, uv).r;
      float net = texture2D(tMasque, uv).r;
      return clamp((flou - net) * 2.0, 0.0, 1.0);
    }

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // scène + fleur du bloom, en un point
    vec3 lire(vec2 uv) {
      return texture2D(tDiffuse, uv).rgb + texture2D(tFleur, uv).rgb * uFleur;
    }

    void main() {
      vec2 vers = vUv - 0.5;
      float d = length(vers);

      // ABERRATION CHROMATIQUE — nulle au centre, croissant au carré de
      // l'excentricité : un bord d'objectif, pas un filtre. Elle demande
      // trois lectures ; au centre les trois portent sur le même point,
      // mais un GPU ne saute pas une lecture pour autant.
      vec2 dec = vers * d * d * uAberration;
      vec3 col = vec3(lire(vUv - dec).r, lire(vUv).g, lire(vUv + dec).b);

      // COURBE DE TONS puis ESPACE COLORIMÉTRIQUE, dans cet ordre — c'est
      // celui d'OutputPass, dont cette passe reprend le travail mot pour mot.
      #ifdef LINEAR_TONE_MAPPING
        col = LinearToneMapping(col);
      #elif defined( REINHARD_TONE_MAPPING )
        col = ReinhardToneMapping(col);
      #elif defined( CINEON_TONE_MAPPING )
        col = OptimizedCineonToneMapping(col);
      #elif defined( ACES_FILMIC_TONE_MAPPING )
        col = ACESFilmicToneMapping(col);
      #elif defined( AGX_TONE_MAPPING )
        col = AgXToneMapping(col);
      #elif defined( NEUTRAL_TONE_MAPPING )
        col = NeutralToneMapping(col);
      #endif

      vec4 sortie = vec4(col, 1.0);
      #ifdef SRGB_TRANSFER
        sortie = sRGBTransferOETF(sortie);
      #endif

      // LE SURVOL, sur l'image encodée : un liseré est un trait d'écran,
      // pas une lumière — il se pose après la courbe de tons
      if (uContour > 0.0) {
        sortie.rgb = mix(sortie.rgb, uContourCouleur, contour(vUv) * uContour);
      }

      // GRAIN et VIGNETTAGE, après l'encodage : ils se règlent à l'œil sur
      // l'image finie, pas sur des valeurs linéaires.
      sortie.rgb += (rand(vUv + fract(uTime * 61.7)) - 0.5) * uGrain;
      sortie.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * uVignette;
      gl_FragColor = sortie;
    }`
};

/* ---------------------------------------------------------------- passe --- */

export class PasseSortie extends Pass {
  /**
   * @param {BloomFleur|null} bloom  la fleur à ajouter, ou null (sans bloom)
   * @param {object|null} source  la passe de scène, quand on peut lire sa
   *   cible sans passer par le ping-pong du composer (voir PasseSceneMSAA)
   */
  constructor(bloom = null, source = null) {
    super();
    this.bloom = bloom;
    this.source = source;
    this.uniforms = UniformsUtils.clone(SORTIE.uniforms);
    this.material = new RawShaderMaterial({
      name: SORTIE.name,
      uniforms: this.uniforms,
      vertexShader: SORTIE.vertexShader,
      fragmentShader: SORTIE.fragmentShader
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this._espace = null;
    this._courbe = null;
    this._grain = SORTIE.uniforms.uGrain.value;
  }

  /** Le bloom, allumé ou éteint (gouverneur de qualité). */
  get bloomActif() { return this.uniforms.uFleur.value > 0; }
  set bloomActif(on) { this.uniforms.uFleur.value = on ? 1 : 0; }

  /** Le grain, allumé ou éteint — sa force d'origine est conservée. */
  get grainActif() { return this.uniforms.uGrain.value > 0; }
  set grainActif(on) { this.uniforms.uGrain.value = on ? this._grain : 0; }

  setSize(width, height) {
    // la pyramide du bloom suit la taille de l'image, comme quand elle
    // était une passe du composer
    this.bloom?.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    // La scène telle qu'elle nous arrive : directement la cible de la passe
    // de scène quand rien ne s'est intercalé, sinon le tampon de la chaîne.
    const scene = this.source && !this.source.copieNecessaire
      ? this.source.cible : readBuffer;
    const fleur = this.bloom && this.bloomActif
      ? this.bloom.calculerFleur(renderer, scene)
      : null;
    this.uniforms.tDiffuse.value = scene.texture;
    // sans bloom, `tFleur` doit rester une texture VALIDE : un
    // échantillonneur non lié rend du noir sur la plupart des pilotes mais
    // fait hurler les autres. On garde donc la dernière fleur et on annule
    // sa contribution par `uFleur`.
    this.uniforms.tFleur.value = fleur
      ?? this.bloom?.renderTargetsHorizontal?.[0]?.texture
      ?? scene.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;

    if (this._espace !== renderer.outputColorSpace || this._courbe !== renderer.toneMapping) {
      this._espace = renderer.outputColorSpace;
      this._courbe = renderer.toneMapping;
      this.material.defines = {};
      if (ColorManagement.getTransfer(this._espace) === SRGBTransfer) {
        this.material.defines.SRGB_TRANSFER = '';
      }
      if (this._courbe === LinearToneMapping) this.material.defines.LINEAR_TONE_MAPPING = '';
      else if (this._courbe === ReinhardToneMapping) this.material.defines.REINHARD_TONE_MAPPING = '';
      else if (this._courbe === CineonToneMapping) this.material.defines.CINEON_TONE_MAPPING = '';
      else if (this._courbe === ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = '';
      else if (this._courbe === AgXToneMapping) this.material.defines.AGX_TONE_MAPPING = '';
      else if (this._courbe === NeutralToneMapping) this.material.defines.NEUTRAL_TONE_MAPPING = '';
      this.material.needsUpdate = true;
    }

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.bloom?.dispose();
  }
}

/**
 * La passe de scène doit-elle recopier sa cible dans la chaîne ?
 *
 * Oui — et seulement — si une passe ACTIVE se tient entre elle et la
 * sortie : c'est celle-là qui lira le tampon du composer (l'occlusion
 * ambiante sur bureau, le warp pendant un franchissement de portail). Sans
 * personne entre les deux, la sortie va lire la cible directement et la
 * copie est une image entière écrite pour rien.
 *
 * Fonction pure, pour que la règle soit vérifiable sans WebGL : c'est elle
 * qui décide si l'image passe par le chemin court ou le chemin long.
 *
 * @param {Array<{enabled: boolean}>} passes  les passes du composer, en ordre
 * @param {object} scene  la passe de scène
 * @param {object} sortie la passe de sortie
 */
export function copieSceneNecessaire(passes, scene, sortie) {
  if (!Array.isArray(passes)) return true;
  const debut = passes.indexOf(scene);
  const fin = passes.indexOf(sortie);
  // l'une des deux manque, ou elles sont dans le désordre : on ne parie pas
  if (debut < 0 || fin < 0 || fin < debut) return true;
  for (let i = debut + 1; i < fin; i++) {
    if (passes[i].enabled) return true;
  }
  return false;
}

/** Taille de la pyramide du bloom, en pixels d'image. */
export function tailleBloom(profile) {
  return new Vector2(
    Math.max(1, Math.round(window.innerWidth * profile.bloomResScale)),
    Math.max(1, Math.round(window.innerHeight * profile.bloomResScale))
  );
}
