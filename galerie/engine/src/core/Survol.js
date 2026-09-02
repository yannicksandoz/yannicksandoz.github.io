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
 * cible à demi-résolution (un dessin, aucun éclairage) ; la passe de
 * sortie dilate ce masque de quelques texels et ne garde que la couronne —
 * le contour. Un plan, un modèle, un relief, un voxel : tout ce qui se
 * dessine se détoure, sans coque inversée ni géométrie d'arêtes. Le
 * masque ignore la profondeur : un liseré discret n'a pas besoin d'être
 * occulté correctement, et une lecture de profondeur coûterait plus que
 * tout le reste.
 *
 * Le liseré APPARAÎT en fondu (150 ms) et s'efface de même : une œuvre
 * frôlée en passant ne clignote pas.
 */
import * as THREE from 'three';

const FONDU = 0.15;          // secondes, montée et descente
const ECHELLE = 0.5;         // le masque se rend à demi-résolution

export class Survol {
  constructor(renderer) {
    this.renderer = renderer;
    this.cible = null;        // l'Artwork visée, ou null
    this.force = 0;           // 0..1, le fondu
    this._masque = new THREE.MeshBasicMaterial({
      color: 0xffffff, depthTest: false, depthWrite: false, fog: false,
      side: THREE.DoubleSide
    });
    this._rt = null;
    this._camera = null;
    this._echanges = [];
  }

  get texture() { return this._rt?.texture ?? null; }

  /** Vise une œuvre (ou rien) : le fondu fait le reste. */
  viser(artwork) {
    this.cible = artwork ?? null;
  }

  /** Taille du masque en texels — la passe de sortie s'en sert. */
  get taille() {
    return this._rt ? new THREE.Vector2(this._rt.width, this._rt.height) : null;
  }

  _cibleAJour() {
    const t = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(t.x * ECHELLE));
    const h = Math.max(2, Math.round(t.y * ECHELLE));
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    this._rt?.dispose();
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
    });
  }

  /**
   * À appeler AVANT le rendu de la frame. Rend false si rien n'est à
   * dessiner (la sortie coupe alors le contour) — c'est le cas presque
   * tout le temps, et cela ne coûte alors qu'un test.
   */
  rendre(camera, dt, { reducedMotion = false } = {}) {
    const veut = this.cible && this.cible.mesh && !this.cible.mediaError ? 1 : 0;
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
    // le blanc plat remplace chaque matériau le temps d'un dessin
    this._echanges.length = 0;
    racine.traverse((o) => {
      if (o.isMesh && o.material && !o.userData.horsSurvol) {
        this._echanges.push([o, o.material]);
        o.material = this._masque;
      }
    });
    if (!this._echanges.length) return false;
    const r = this.renderer;
    const cibleAvant = r.getRenderTarget();
    const clearAvant = r.autoClear;
    r.setRenderTarget(this._rt);
    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(racine, camera);
    r.autoClear = clearAvant;
    r.setRenderTarget(cibleAvant);
    for (const [o, m] of this._echanges) o.material = m;
    this._echanges.length = 0;
    return true;
  }

  dispose() {
    this._rt?.dispose();
    this._masque.dispose();
  }
}
