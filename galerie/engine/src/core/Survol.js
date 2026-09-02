/**
 * Le survol — un détourage léger de l'œuvre que l'on vise.
 *
 * Passer le pointeur sur une œuvre la souligne d'un fin liseré : c'est la
 * réponse muette à « est-ce que ça se clique ? ». Sur tactile, où rien ne
 * survole, c'est l'œuvre au centre de l'écran qui le porte — la même que
 * la barre d'espace « découvre » (App.triggerAction) : le liseré dit alors
 * ce qu'un geste va toucher.
 *
 * Technique : l'œuvre visée est redessinée SEULE, en blanc plat, dans une
 * cible à demi-résolution MULTI-ÉCHANTILLONNÉE (un dessin, aucun
 * éclairage — mais des bords doux), puis ce masque est FLOUTÉ (gaussienne
 * séparable, deux passes de neuf lectures). La passe de sortie n'a plus
 * qu'à soustraire : ce que le flou déborde du masque, c'est la couronne —
 * un dégradé continu qui s'éteint en quelques pixels, sans marche. La
 * première version dilatait le masque par un « max » de huit lectures :
 * une couronne à bords durs, en escalier, et un dégradé qui n'en était
 * pas un. Un plan, un modèle, un relief, un voxel : tout ce qui se
 * dessine se détoure, sans coque inversée ni géométrie d'arêtes. Le
 * masque ignore la profondeur : un liseré discret n'a pas besoin d'être
 * occulté correctement, et une lecture de profondeur coûterait plus que
 * tout le reste.
 *
 * Le liseré APPARAÎT en fondu (150 ms) et s'efface de même : une œuvre
 * frôlée en passant ne clignote pas.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FONDU = 0.15;          // secondes, montée et descente
const ECHELLE = 0.5;         // le masque se rend à demi-résolution
const ECHANTILLONS = 4;      // MSAA du masque : des bords doux dès le dessin

// Gaussienne à neuf lectures (σ ≈ 2 pas), les lectures espacées d'un
// texel et demi de demi-résolution : une portée d'une douzaine de pixels
// à l'écran — assez pour un dégradé, pas assez pour un halo.
const POIDS = [0.0276, 0.0663, 0.1238, 0.1802, 0.2042, 0.1802, 0.1238, 0.0663, 0.0276];
const PAS = 1.5;

const FLOU_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FLOU_FRAGMENT = /* glsl */`
  uniform sampler2D tSource;
  uniform vec2 uPas;          // un texel, dans l'axe de la passe
  varying vec2 vUv;
  void main() {
    float s = 0.0;
    ${POIDS.map((p, i) => `s += texture2D(tSource, vUv + uPas * ${(i - 4).toFixed(1)}).r * ${p};`).join('\n    ')}
    gl_FragColor = vec4(s, s, s, 1.0);
  }
`;

export class Survol {
  constructor(renderer) {
    this.renderer = renderer;
    this.cible = null;        // l'Artwork visée, ou null
    this.force = 0;           // 0..1, le fondu
    this._masque = new THREE.MeshBasicMaterial({
      color: 0xffffff, depthTest: false, depthWrite: false, fog: false,
      side: THREE.DoubleSide
    });
    this._rt = null;          // le masque net (multi-échantillonné)
    this._rtH = null;         // flou horizontal
    this._rtV = null;         // flou vertical — la texture floue lue à la sortie
    this._flou = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null }, uPas: { value: new THREE.Vector2() } },
      vertexShader: FLOU_VERTEX, fragmentShader: FLOU_FRAGMENT,
      depthTest: false, depthWrite: false
    });
    this._quad = new FullScreenQuad(this._flou);
    this._echanges = [];       // [objet, matériau] rendus le temps du dessin
    this._caches = [];         // objets `horsSurvol` cachés le temps du dessin
    this._couleur = new THREE.Color();
  }

  /** Le masque net : la silhouette, bords adoucis par le MSAA. */
  get texture() { return this._rt?.texture ?? null; }

  /** Le masque flouté : ce qu'il déborde de la silhouette fait le liseré. */
  get textureFloue() { return this._rtV?.texture ?? null; }

  /** Vise une œuvre (ou rien) : le fondu fait le reste. */
  viser(artwork) {
    this.cible = artwork ?? null;
  }

  _cibleAJour() {
    const t = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(t.x * ECHELLE));
    const h = Math.max(2, Math.round(t.y * ECHELLE));
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    this._rt?.dispose(); this._rtH?.dispose(); this._rtV?.dispose();
    const options = {
      depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
    };
    this._rt = new THREE.WebGLRenderTarget(w, h, { ...options, samples: ECHANTILLONS });
    this._rtH = new THREE.WebGLRenderTarget(w, h, options);
    this._rtV = new THREE.WebGLRenderTarget(w, h, options);
  }

  /**
   * À appeler AVANT le rendu de la frame. Rend false si rien n'est à
   * dessiner (la sortie coupe alors le contour) — c'est le cas presque
   * tout le temps, et cela ne coûte alors qu'un test.
   */
  rendre(camera, dt, { reducedMotion = false } = {}) {
    const veut = this.cible && this.cible.mesh && !this.cible.mediaError
      && !this.cible.sansSurvol ? 1 : 0;
    if (reducedMotion) this.force = veut;
    else {
      const pas = dt / FONDU;
      this.force = veut ? Math.min(1, this.force + pas) : Math.max(0, this.force - pas);
    }
    if (this.force <= 0) return false;
    // la cible s'efface : on garde le dernier masque le temps du fondu
    if (!veut) return true;

    this._cibleAJour();
    const racine = this.cible.mesh;
    // Le blanc plat remplace chaque matériau le temps d'un dessin. Ce qui
    // porte `horsSurvol` (un nuage de splats, dont le shader lit SES
    // uniforms depuis son propre matériau) ne s'échange pas : il se CACHE
    // pendant le dessin — le pavé de préhension du scan fait alors
    // silhouette à sa place.
    this._echanges.length = 0;
    this._caches.length = 0;
    racine.traverse((o) => {
      if (o.userData.horsSurvol) {
        if (o.visible) { this._caches.push(o); o.visible = false; }
      } else if (o.isMesh && o.material) {
        this._echanges.push([o, o.material]);
        o.material = this._masque;
      }
    });
    if (!this._echanges.length) { this._restaurer(); return false; }
    const r = this.renderer;
    const cibleAvant = r.getRenderTarget();
    const clearAvant = r.autoClear;
    const couleurAvant = r.getClearColor(this._couleur);
    const alphaAvant = r.getClearAlpha();
    // Le dessin est CEINTURÉ : une erreur au milieu (un objet qui ne
    // supporte pas l'échange) laissait la cible de rendu sur le masque, et
    // tout ce qui suivait se dessinait hors écran — l'image entière noire,
    // dans toutes les pièces. Quoi qu'il arrive, l'écran est rendu et les
    // matériaux reviennent ; l'œuvre fautive renonce à son liseré.
    try {
      r.setRenderTarget(this._rt);
      r.autoClear = true;
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      r.render(racine, camera);
      // le flou, en deux passes : horizontale vers H, verticale vers V
      const u = this._flou.uniforms;
      u.tSource.value = this._rt.texture;
      // pas d'un texel et demi (le filtrage linéaire lisse entre deux) :
      // une portée d'une douzaine de pixels à l'écran, le dégradé se lit
      u.uPas.value.set(PAS / this._rt.width, 0);
      r.setRenderTarget(this._rtH);
      this._quad.render(r);
      u.tSource.value = this._rtH.texture;
      u.uPas.value.set(0, PAS / this._rt.height);
      r.setRenderTarget(this._rtV);
      this._quad.render(r);
    } catch (e) {
      console.warn(`[galerie] Survol : l'œuvre ${this.cible.config?.id ?? '?'} `
        + `ne se détoure pas — ${e?.message ?? e}`);
      this.cible.sansSurvol = true;
      this.force = 0;
      return false;
    } finally {
      r.autoClear = clearAvant;
      r.setClearColor(couleurAvant, alphaAvant);
      r.setRenderTarget(cibleAvant);
      this._restaurer();
    }
    return true;
  }

  _restaurer() {
    for (const [o, m] of this._echanges) o.material = m;
    this._echanges.length = 0;
    for (const o of this._caches) o.visible = true;
    this._caches.length = 0;
  }

  dispose() {
    this._rt?.dispose(); this._rtH?.dispose(); this._rtV?.dispose();
    this._masque.dispose();
    this._flou.dispose();
    this._quad.dispose();
  }
}
