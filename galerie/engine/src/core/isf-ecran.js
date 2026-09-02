/**
 * L'écran ISF — un shader de VJing rendu dans une texture.
 *
 * Le fragment converti (voir isf.js) peint un quad plein cadre dans une
 * render target ; la texture obtenue habille ensuite n'importe quelle
 * forme de la galerie — panneau, sphère, monolithe — et peut servir de
 * carte de déplacement pour un relief. C'est ce détour par la texture qui
 * rend les shaders COMPATIBLES avec tout le reste : lumière, ombres,
 * matières, gouverneur de qualité (la résolution est le seul coût).
 *
 * Le rendu se fait HORS de la passe principale (Artwork.update, avant le
 * rendu de la frame), à cadence bornée : un shader de VJing à 30 Hz reste
 * un shader de VJing, et deux écrans dans une salle ne mangent pas la
 * marge du mobile.
 */
import * as THREE from 'three';
import { fragmentDe, valeursDe, VERTEX_ISF } from './isf.js';

const CADENCE = 1 / 30;   // secondes entre deux rendus d'écran

export class EcranISF {
  /**
   * @param {string} source  le fichier ISF complet (en-tête + GLSL)
   * @param {object} options resolution (128–1024)
   * @throws si le shader n'est pas convertible (le message liste pourquoi)
   */
  constructor(source, { resolution = 512 } = {}) {
    const conv = fragmentDe(source);
    if (!conv || conv.problemes?.length) {
      throw new Error(`ISF inconvertible : ${conv?.problemes?.join(' ; ') ?? 'en-tête introuvable'}`);
    }
    this.entrees = conv.entrees;
    const res = Math.max(128, Math.min(1024, Math.round(resolution)));
    this.cible = new THREE.WebGLRenderTarget(res, res, {
      depthBuffer: false, stencilBuffer: false
    });
    // un shader d'auteur pense en couleurs d'écran : la texture se déclare
    // sRGB pour que le pipeline linéaire de three la lise juste
    this.cible.texture.colorSpace = THREE.SRGBColorSpace;

    this.uniforms = {
      TIME: { value: 0 },
      RENDERSIZE: { value: new THREE.Vector2(res, res) }
    };
    for (const e of this.entrees) {
      this.uniforms[e.nom] = { value: this._enveloppe(e, e.defaut) };
    }
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._matiere = new THREE.ShaderMaterial({
      vertexShader: VERTEX_ISF,
      fragmentShader: conv.fragment,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._matiere));
    this._accu = CADENCE; // premier rendu dès la première frame
  }

  get texture() { return this.cible.texture; }

  /** vec4/vec2 pour three, scalaires tels quels. */
  _enveloppe(entree, valeur) {
    if (entree.type === 'color') {
      const c = Array.isArray(valeur) ? valeur : [1, 1, 1, 1];
      return new THREE.Vector4(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1);
    }
    if (entree.type === 'point2D') {
      const p = Array.isArray(valeur) ? valeur : [0, 0];
      return new THREE.Vector2(p[0] ?? 0, p[1] ?? 0);
    }
    return valeur;
  }

  /** Applique un jeu de réglages (JSON de l'œuvre, inspecteur en direct). */
  appliquer(reglages = {}) {
    const valeurs = valeursDe(this.entrees, reglages);
    for (const e of this.entrees) {
      this.poser(e.nom, valeurs[e.nom]);
    }
  }

  /** Pose UNE entrée (liaison audio, curseur de l'inspecteur). */
  poser(nom, valeur) {
    const u = this.uniforms[nom];
    if (!u) return;
    const entree = this.entrees.find((e) => e.nom === nom);
    if (!entree) return;
    if (entree.type === 'color' || entree.type === 'point2D') {
      const v = this._enveloppe(entree, valeur);
      u.value.copy ? u.value.copy(v) : (u.value = v);
    } else {
      u.value = entree.type === 'bool' ? Boolean(valeur) : Number(valeur) || 0;
    }
  }

  /**
   * Rend l'écran si sa cadence l'y invite. À appeler pendant update, JAMAIS
   * pendant la passe de rendu principale — on emprunte le renderer et on le
   * rend dans l'état exact où on l'a pris.
   */
  rendre(renderer, temps, dt) {
    this._accu += dt;
    if (this._accu < CADENCE) return false;
    this._accu = 0;
    this.uniforms.TIME.value = temps;
    const cibleAvant = renderer.getRenderTarget();
    renderer.setRenderTarget(this.cible);
    renderer.render(this._scene, this._camera);
    renderer.setRenderTarget(cibleAvant);
    return true;
  }

  dispose() {
    this.cible.dispose();
    this._matiere.dispose();
    this._scene.traverse((o) => o.geometry?.dispose?.());
  }
}
