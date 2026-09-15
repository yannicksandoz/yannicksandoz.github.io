/**
 * Le survol — un détourage léger de l'œuvre que l'on vise.
 *
 * Passer le pointeur sur une œuvre la souligne d'un fin liseré : c'est la
 * réponse muette à « est-ce que ça se clique ? ». Sur tactile, où rien ne
 * survole, c'est l'œuvre au centre de l'écran qui le porte — la même que
 * la barre d'espace « découvre » (App.triggerAction) : le liseré dit alors
 * ce qu'un geste va toucher.
 *
 * Technique : le masque vit DANS L'IMAGE. Juste après le dessin de la
 * scène, dans la même cible (PasseSceneMSAA), le canal alpha est remis à
 * zéro, puis l'œuvre visée est redessinée en n'écrivant QUE l'alpha, à un,
 * avec le test de profondeur de la scène. C'est tout ce que fait ce
 * module. La passe de sortie lit cet alpha et compare chaque pixel à ses
 * voisins (quatre anneaux de huit lectures, pondérés par la distance, voir
 * PasseSortie.contour) : ce que les voisins ont de blanc et que le pixel
 * n'a pas, c'est la couronne — un dégradé de quatre pixels, au ras de la
 * silhouette.
 *
 * Pourquoi dans l'image et non dans une cible à part : il y a eu trois
 * versions à cible séparée. Un « max » à demi-résolution (un escalier) ;
 * un flou séparable soustrait (joli sur bureau, fantôme sur iPhone) ; puis
 * une cible à la taille exacte du tampon, multi-échantillonnée, occultée
 * par une pré-passe de toute la pièce. Cette dernière collait au pixel en
 * émulation — et se décalait encore de l'œuvre sur un iPhone réel en
 * marchant, la silhouette même (vue par `?survol=masque`), pas seulement
 * sa couronne. Deux cibles, c'est deux résolutions MSAA, deux fenêtres de
 * rendu, deux instants : autant de coutures que WebKit ne recoud pas comme
 * Chromium. Un masque écrit dans la cible de scène, par le même appel de
 * caméra, la même fenêtre et la même résolution, ne PEUT pas se décaler :
 * il n'existe pas ailleurs que dans l'image.
 *
 * Et c'est moins cher : l'occlusion (le pied d'une stèle sous le sol, une
 * œuvre à moitié derrière un mur) vient gratuitement du tampon de
 * profondeur que la scène vient d'écrire — plus de pré-passe de la pièce
 * entière, plus de cible MSAA à profondeur en plus de celle de la scène.
 *
 * Le liseré APPARAÎT en fondu (150 ms) et s'efface de même : une œuvre
 * frôlée en passant ne clignote pas.
 */
import * as THREE from 'three';

const FONDU = 0.15;          // secondes, montée et descente

export class Survol {
  constructor() {
    this.cible = null;        // l'Artwork visée, ou null
    this.force = 0;           // 0..1, le fondu
    this._derniere = null;    // l'œuvre dessinée tant que le fondu descend
    // LE PINCEAU À ALPHA : la couleur ne change pas (source × 0 + cible
    // × 1), l'alpha devient un (source × 1 + cible × 0). Testé contre la
    // profondeur que la scène vient d'écrire — « inférieur ou égal », donc
    // l'œuvre repasse exactement sur elle-même — sans l'écrire.
    this._masque = new THREE.MeshBasicMaterial({
      color: 0xffffff, opacity: 1, fog: false, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor
    });
    this._echanges = [];       // [objet, matériau] rendus le temps du dessin
    this._caches = [];         // objets `horsSurvol` cachés le temps du dessin
    this._couleur = new THREE.Color();
    // la couleur du liseré, lue par la sortie à chaque image : blanc pour
    // une œuvre, or pour un jeton ◈ (voir `viser`)
    this.couleur = new THREE.Color(0xffffff);
    this._blanc = new THREE.Color(0xffffff);
    this._or = new THREE.Color(0xffd97a);
  }

  /** Vise une œuvre (ou rien) : le fondu fait le reste. */
  viser(artwork) {
    this.cible = artwork ?? null;
    if (this.cible) this.couleur.copy(this.cible.jeton ? this._or : this._blanc);
  }

  /** L'œuvre qu'un dessin représenterait à cette image, ou null. */
  _dessinable() {
    const c = this.cible;
    return c && c.mesh && !c.mediaError && !c.sansSurvol ? c : null;
  }

  /**
   * À appeler à chaque image, AVANT le rendu : avance le fondu. Rend true
   * s'il y a un liseré à montrer (la sortie coupe le contour sinon — c'est
   * le cas presque tout le temps, et cela ne coûte alors qu'un test).
   */
  avancer(dt, { reducedMotion = false } = {}) {
    const veut = this._dessinable();
    if (veut) this._derniere = veut;
    if (reducedMotion) this.force = veut ? 1 : 0;
    else {
      const pas = dt / FONDU;
      this.force = veut ? Math.min(1, this.force + pas) : Math.max(0, this.force - pas);
    }
    if (this.force <= 0) this._derniere = null;
    return this.force > 0 && !!this._derniere;
  }

  /**
   * À appeler juste APRÈS le dessin de la scène, la cible de scène encore
   * liée : écrit le masque dans son alpha. Rend true si quelque chose a été
   * dessiné.
   */
  dessiner(renderer, camera) {
    const oeuvre = this._derniere;
    if (this.force <= 0 || !oeuvre?.mesh) return false;
    const racine = oeuvre.mesh;
    // l'œuvre là où elle est À CETTE IMAGE — la scène vient de la dessiner
    // au même endroit, le test « inférieur ou égal » retombe dessus
    racine.updateMatrixWorld(true);
    // Le pinceau remplace chaque matériau le temps d'un dessin. Ce qui
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
    const r = renderer;
    const clearAvant = r.autoClear;
    const couleurAvant = r.getClearColor(this._couleur).clone();
    const alphaAvant = r.getClearAlpha();
    const gl = r.getContext();
    const masqueCouleur = r.state.buffers.color;
    // Le dessin est CEINTURÉ : une erreur au milieu (un objet qui ne
    // supporte pas l'échange) laissait autrefois la cible de rendu sur le
    // masque, et tout ce qui suivait se dessinait hors écran. Quoi qu'il
    // arrive, l'état revient et les matériaux aussi ; l'œuvre fautive
    // renonce à son liseré.
    try {
      r.autoClear = false;
      // 1. l'alpha de toute l'image à zéro — un effacement, pas un quad :
      // le masque de couleur ne laisse passer que l'alpha, et `clear`
      // n'écrit que ce canal. (three cache son masque de couleur : on le
      // bascule ensuite à la main pour que son cache reste vrai.)
      gl.colorMask(false, false, false, true);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      masqueCouleur.setMask(false);
      masqueCouleur.setMask(true);
      // 2. l'œuvre, alpha seul, contre la profondeur de la scène
      r.render(racine, camera);
    } catch (e) {
      console.warn(`[galerie] Survol : l'œuvre ${oeuvre.config?.id ?? '?'} `
        + `ne se détoure pas — ${e?.message ?? e}`);
      oeuvre.sansSurvol = true;
      this.force = 0;
      this._derniere = null;
      return false;
    } finally {
      masqueCouleur.setMask(false);
      masqueCouleur.setMask(true);
      r.autoClear = clearAvant;
      r.setClearColor(couleurAvant, alphaAvant);
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
    this._masque.dispose();
  }
}
