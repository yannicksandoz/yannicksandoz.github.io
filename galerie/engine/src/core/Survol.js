/**
 * Le survol — un détourage léger de l'œuvre que l'on vise.
 *
 * Passer le pointeur sur une œuvre la souligne d'un fin liseré : c'est la
 * réponse muette à « est-ce que ça se clique ? ». Sur tactile, où rien ne
 * survole, c'est l'œuvre au centre de l'écran qui le porte — la même que
 * la barre d'espace « découvre » (App.triggerAction) : le liseré dit alors
 * ce qu'un geste va toucher.
 *
 * Technique : l'œuvre visée est redessinée SEULE, en blanc plat, dans UNE
 * cible à la résolution de l'image (un dessin, aucun éclairage). C'est
 * tout ce que fait ce module. La passe de sortie lit ce masque et compare
 * chaque pixel à ses voisins (quatre anneaux de huit lectures, pondérés
 * par la distance, voir PasseSortie.contour) : ce que les voisins ont de
 * blanc et que le pixel n'a pas, c'est la couronne — un dégradé de quatre
 * pixels, au ras de la silhouette.
 *
 * Il y a eu deux autres versions. La première dilatait le masque par un
 * « max » à huit lectures d'un masque à demi-résolution : un escalier. La
 * deuxième floutait le masque en deux passes séparables à demi-résolution
 * et soustrayait : joli sur bureau, mais sur iPhone le liseré se décalait
 * de l'œuvre en une image fantôme, et pixelisait. Trois cibles de tailles
 * différentes, un flou lu à travers un filtrage linéaire de WebKit et des
 * échelles de texels à réconcilier : trop de coutures pour un trait.
 * Celle-ci n'a qu'une cible, à la taille EXACTE du tampon de dessin, lue
 * par la sortie avec son propre pas de texel (`texel`) : le liseré est
 * là où la silhouette est, au pixel près, quel que soit l'écran.
 *
 * L'occlusion (une pré-passe de profondeur de la pièce, pour ne pas
 * détourer le pied d'une stèle sous le sol) est un CHOIX du profil : sur
 * bureau oui ; sur téléphone non — une cible à profondeur, multi-
 * échantillonnée ou pas, est justement ce que WebKit résolvait de travers.
 *
 * Le liseré APPARAÎT en fondu (150 ms) et s'efface de même : une œuvre
 * frôlée en passant ne clignote pas.
 */
import * as THREE from 'three';

const FONDU = 0.15;          // secondes, montée et descente
const ECHELLE = 1;           // le masque se rend à la résolution de l'image
const ECHANTILLONS = 4;      // MSAA du masque : des bords doux dès le dessin

export class Survol {
  /**
   * `echelle` : la résolution du masque, en fraction du tampon de dessin
   * (densité comprise). `echantillons` : le MSAA du masque, 0 pour aucun.
   * `occlusion` : tester la profondeur de la pièce (pré-passe) ou non.
   * Voir Quality : bureau 1 / 4 / oui, téléphone 1 / 0 / non.
   */
  constructor(renderer, { echelle = ECHELLE, echantillons = ECHANTILLONS, occlusion = true } = {}) {
    this.renderer = renderer;
    this.echelle = Math.max(0.25, Math.min(1, Number(echelle) || ECHELLE));
    this.echantillons = Math.max(0, Math.min(8, Number(echantillons) ?? ECHANTILLONS));
    this.occlusion = occlusion !== false;
    this.cible = null;        // l'Artwork visée, ou null
    this.force = 0;           // 0..1, le fondu
    // 1 / taille du masque : le pas d'un texel, lu par la sortie pour
    // chercher les voisins à la bonne distance (voir PasseSortie.contour)
    this.texel = new THREE.Vector2(1 / 1920, 1 / 1080);
    // Le blanc plat de la cible. Avec occlusion, il est TESTÉ en
    // profondeur contre la pièce : ce qui est caché (le pied d'une stèle
    // sous le sol, une œuvre derrière un mur) ne se détoure pas. La
    // profondeur vient d'une pré-passe de la pièce courante dans la même
    // cible (voir `rendre`).
    this._masque = new THREE.MeshBasicMaterial({
      color: 0xffffff, depthTest: this.occlusion, depthWrite: false, fog: false,
      side: THREE.DoubleSide
    });
    // la pré-passe : la pièce entière, profondeur seule, aucune couleur
    this._profondeur = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false, side: THREE.DoubleSide });
    this._sceneOcc = new THREE.Scene();
    this._sceneOcc.overrideMaterial = this._profondeur;
    this._rt = null;          // le masque : la seule cible
    this._echanges = [];       // [objet, matériau] rendus le temps du dessin
    this._caches = [];         // objets `horsSurvol` cachés le temps du dessin
    this._couleur = new THREE.Color();
    // la couleur du liseré, lue par la sortie à chaque image : blanc pour
    // une œuvre, or pour un jeton ◈ (voir `viser`)
    this.couleur = new THREE.Color(0xffffff);
    this._blanc = new THREE.Color(0xffffff);
    this._or = new THREE.Color(0xffd97a);
  }

  /** Le masque : la silhouette, blanc sur noir. */
  get texture() { return this._rt?.texture ?? null; }

  /** Vise une œuvre (ou rien) : le fondu fait le reste. */
  viser(artwork) {
    this.cible = artwork ?? null;
    if (this.cible) this.couleur.copy(this.cible.jeton ? this._or : this._blanc);
  }

  _cibleAJour() {
    // la taille en PIXELS d'image (densité comprise) : c'est là que se juge
    // la finesse du masque — un masque à demi-résolution CSS sur un écran à
    // densité 2 n'était qu'au quart des pixels réels
    const t = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(t.x * this.echelle));
    const h = Math.max(2, Math.round(t.y * this.echelle));
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    this._rt?.dispose();
    // la profondeur n'existe que si l'on occulte : sans elle, la cible est
    // un simple plan de couleur — ce que tous les pilotes résolvent bien
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: this.occlusion, stencilBuffer: false,
      samples: this.echantillons,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
    });
    this.texel.set(1 / w, 1 / h);
  }

  /**
   * À appeler AVANT le rendu de la frame. Rend false si rien n'est à
   * dessiner (la sortie coupe alors le contour) — c'est le cas presque
   * tout le temps, et cela ne coûte alors qu'un test.
   */
  rendre(camera, dt, { reducedMotion = false, occulteurs = null } = {}) {
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
    // l'œuvre là où elle est À CETTE IMAGE : une œuvre qui bouge (un
    // module qui l'anime, un cadrage qui la rapproche) a peut-être changé
    // de place depuis le dernier rendu, et son masque doit la suivre
    racine.updateMatrixWorld(true);
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
      r.autoClear = false;
      r.setClearColor(0x000000, 1);
      r.clear(true, this.occlusion, false);
      // LA PRÉ-PASSE (avec occlusion seulement) : la pièce courante,
      // profondeur seule (matériau de substitution, aucune couleur), dans
      // la même cible. La cible se dessine ensuite en testant cette
      // profondeur : le pied d'une stèle sous le sol, une œuvre derrière
      // un mur, n'entrent pas dans le masque. Ce qui porte `horsSurvol`
      // (les splats) se cache aussi ici : leur shader ne survivrait pas à
      // la substitution.
      if (this.occlusion && occulteurs) {
        occulteurs.traverse((o) => {
          if (o.userData.horsSurvol && o.visible && !this._caches.includes(o)) {
            this._caches.push(o); o.visible = false;
          }
        });
        // l'objet reste l'enfant de sa vraie scène : on ne l'emprunte que
        // pour ce dessin, sans toucher à sa parenté (updateMatrixWorld
        // recalcule depuis une racine identité, comme la scène réelle)
        this._sceneOcc.children.length = 0;
        this._sceneOcc.children.push(occulteurs);
        try { r.render(this._sceneOcc, camera); }
        finally { this._sceneOcc.children.length = 0; }
        // la cible fait partie de la pièce : la pré-passe a écrit sa vraie
        // profondeur (le matériau de substitution prime sur l'échange), et
        // le test « inférieur ou égal » laisse passer son blanc juste après
      }
      r.render(racine, camera);
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
    this._rt?.dispose();
    this._masque.dispose();
    this._profondeur.dispose();
  }
}
