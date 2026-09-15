/**
 * Le survol — un détourage léger de l'œuvre que l'on vise.
 *
 * Passer le pointeur sur une œuvre la souligne d'un fin liseré : c'est la
 * réponse muette à « est-ce que ça se clique ? ». Sur tactile, où rien ne
 * survole, c'est l'œuvre au centre de l'écran qui le porte — la même que
 * la barre d'espace « découvre » (App.triggerAction) : le liseré dit alors
 * ce qu'un geste va toucher.
 *
 * Technique : le masque vit DANS L'IMAGE, et se dessine DANS LA PASSE de
 * la scène. Une SENTINELLE — un triangle plein écran, transparent, d'ordre
 * de rendu infini, donc le tout dernier objet que three dessine — remet le
 * canal alpha de l'image à zéro par son propre dessin (mélange : couleur ×
 * 0 + image × 1, alpha × 0 + image × 0) ; puis, dans son `onAfterRender`,
 * elle redessine l'œuvre visée par `renderer.renderBufferDirect`, en
 * n'écrivant QUE l'alpha, à un, avec le test de profondeur que la scène
 * vient d'écrire. C'est tout ce que fait ce module. La passe de sortie lit
 * cet alpha et compare chaque pixel à ses voisins (quatre anneaux de huit
 * lectures, pondérés par la distance, voir PasseSortie.contour) : ce que
 * les voisins ont de blanc et que le pixel n'a pas, c'est la couronne — un
 * dégradé de quatre pixels, au ras de la silhouette.
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
 * Pourquoi DANS LA PASSE et non juste après elle : un second
 * `renderer.render` sur la même cible MSAA, c'est une seconde résolution,
 * et sur un GPU à tuiles (tout téléphone) le tampon multi-échantillonné
 * doit alors être ÉCRIT en mémoire à la fin de la scène puis RELU au début
 * du masque — des mégaoctets par image que le rendu normal ne touche
 * jamais (le MSAA y vit dans la tuile et n'en sort que résolu). Mesuré sur
 * iPhone au labo : p95 de 19 à 23 ms. Dessiné dans la passe, le masque ne
 * coûte qu'un triangle plein écran et un dessin de l'œuvre, dans la tuile.
 *
 * Et l'occlusion (le pied d'une stèle sous le sol, une œuvre à moitié
 * derrière un mur) vient gratuitement du tampon de profondeur : plus de
 * pré-passe de la pièce entière, plus de cible à profondeur en plus.
 *
 * Le liseré APPARAÎT en fondu (150 ms) et s'efface de même : une œuvre
 * frôlée en passant ne clignote pas.
 */
import * as THREE from 'three';

const FONDU = 0.15;          // secondes, montée et descente

/** Le triangle plein écran de la sentinelle, en coordonnées d'écran. */
function triangleEcran() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  // jamais tronqué : sa boîte ne dit rien de l'écran
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return g;
}

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
    // L'EFFACEUR D'ALPHA : le dessin de la sentinelle elle-même. Un
    // triangle qui couvre l'écran, sans caméra ni profondeur, et un
    // mélange qui laisse la couleur et met l'alpha à zéro.
    const effaceur = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      transparent: true,          // la liste des transparents : après tout l'opaque
      depthTest: false, depthWrite: false, fog: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor
    });
    this.sentinelle = new THREE.Mesh(triangleEcran(), effaceur);
    this.sentinelle.name = 'survol-sentinelle';
    this.sentinelle.renderOrder = 1e9;     // le tout dernier dessin de la passe
    this.sentinelle.frustumCulled = false;
    this.sentinelle.matrixAutoUpdate = false;
    this.sentinelle.castShadow = false;
    this.sentinelle.receiveShadow = false;
    this.sentinelle.visible = false;       // la passe de scène l'allume (App)
    this.sentinelle.userData.horsReflets = true;
    this.sentinelle.userData.sansOmbre = true;
    this.sentinelle.onAfterRender = (renderer, scene, camera) => this._dessinerOeuvre(renderer, scene, camera);
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

  /** Y a-t-il un masque à dessiner dans la passe de scène ? */
  get actif() { return this.force > 0 && !!this._derniere?.mesh; }

  /**
   * Dans la passe de scène, après l'effacement de l'alpha : l'œuvre, alpha
   * seul, mesh par mesh, par le chemin direct de three (aucun second
   * `render`, aucune seconde résolution).
   */
  _dessinerOeuvre(renderer, scene, camera) {
    const oeuvre = this._derniere;
    if (!this.actif) return;
    const racine = oeuvre.mesh;
    try {
      // l'œuvre là où elle est À CETTE IMAGE — la scène vient de la
      // dessiner au même endroit, le test « inférieur ou égal » retombe dessus
      racine.updateMatrixWorld(true);
      racine.traverseVisible((o) => {
        // ce qui porte `horsSurvol` (un nuage de splats) ne se détoure pas ;
        // ni ce qui n'est pas un maillage (lutins, traits)
        if (!o.isMesh || o.userData.horsSurvol || !o.geometry) return;
        o.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, o.matrixWorld);
        o.normalMatrix.getNormalMatrix(o.modelViewMatrix);
        const groupes = Array.isArray(o.material) ? o.geometry.groups : null;
        if (groupes && groupes.length) {
          for (const g of groupes) renderer.renderBufferDirect(camera, scene, o.geometry, this._masque, o, g);
        } else {
          renderer.renderBufferDirect(camera, scene, o.geometry, this._masque, o, null);
        }
      });
    } catch (e) {
      console.warn(`[galerie] Survol : l'œuvre ${oeuvre.config?.id ?? '?'} `
        + `ne se détoure pas — ${e?.message ?? e}`);
      oeuvre.sansSurvol = true;
      this.force = 0;
      this._derniere = null;
    }
  }

  dispose() {
    this._masque.dispose();
    this.sentinelle.material.dispose();
    this.sentinelle.geometry.dispose();
    this.sentinelle.removeFromParent();
  }
}
