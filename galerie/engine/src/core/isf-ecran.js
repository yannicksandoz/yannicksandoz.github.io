/**
 * L'écran ISF — un ou plusieurs shaders de VJing rendus dans une texture.
 *
 * Le fragment converti (voir isf.js) peint un quad plein cadre dans une
 * render target ; la texture obtenue habille ensuite n'importe quelle
 * forme de la galerie — panneau, sphère, monolithe — et peut servir de
 * carte de déplacement pour un relief, ou de tranches pour un volume.
 * C'est ce détour par la texture qui rend les shaders COMPATIBLES avec
 * tout le reste : lumière, ombres, matières, gouverneur de qualité (la
 * résolution est le seul coût).
 *
 * LES CALQUES : plusieurs shaders se superposent sur le même écran. Le
 * premier peint le fond, opaque ; chaque suivant se dessine par-dessus
 * dans la même cible, avec un mode de fondu (normal, ajouter, écran,
 * multiplier) et une opacité — ce sont les fonctions de fusion du GPU qui
 * mélangent, aucune passe de composition. Un calque illisible est SAUTÉ
 * en le disant (`problemes`), l'écran vit sans lui.
 *
 * Le rendu se fait HORS de la passe principale (Artwork.update, avant le
 * rendu de la frame), à cadence bornée : un shader de VJing à 30 Hz reste
 * un shader de VJing, et deux écrans dans une salle ne mangent pas la
 * marge du mobile.
 */
import * as THREE from 'three';
import { fragmentDe, valeursDe, VERTEX_ISF, envelopperCalque, MODES_FONDU } from './isf.js';

const CADENCE = 1 / 30;   // secondes entre deux rendus d'écran

/** Les fonctions de fusion de chaque mode, pour ShaderMaterial. */
function fusionDe(fondu) {
  switch (fondu) {
    case 'ajouter': return { blending: THREE.AdditiveBlending };
    case 'ecran': return {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor, blendDst: THREE.OneFactor
    };
    case 'multiplier': return {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor
    };
    default: return { blending: THREE.NormalBlending };
  }
}

export class EcranISF {
  /**
   * @param {string|Array} calques  le fichier ISF complet (en-tête + GLSL),
   *   ou une liste [{ source, reglages, fondu, opacite }] — le premier est
   *   le fond
   * @param {object} options resolution (128–1024)
   * @throws si le PREMIER shader n'est pas convertible (le message dit pourquoi)
   */
  constructor(calques, { resolution = 512 } = {}) {
    const liste = typeof calques === 'string' ? [{ source: calques }] : [...(calques ?? [])];
    if (!liste.length) throw new Error('ISF : aucun shader');
    const res = Math.max(128, Math.min(1024, Math.round(resolution)));
    this.cible = new THREE.WebGLRenderTarget(res, res, {
      depthBuffer: false, stencilBuffer: false
    });
    // un shader d'auteur pense en couleurs d'écran : la texture se déclare
    // sRGB pour que le pipeline linéaire de three la lise juste
    this.cible.texture.colorSpace = THREE.SRGBColorSpace;
    this._res = res;
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geometrie = new THREE.PlaneGeometry(2, 2);

    /** Un élément par calque du document, null si ce calque est illisible. */
    this.calques = [];
    this.problemes = [];
    liste.forEach((c, i) => {
      try {
        this.calques.push(this._creerCalque(c ?? {}, i));
      } catch (e) {
        if (i === 0) throw e;   // sans fond, pas d'écran
        this.calques.push(null);
        this.problemes.push(`calque ${i} : ${e.message}`);
      }
    });
    /** Les entrées du fond — ce que la liaison audio et l'inspecteur lisent. */
    this.entrees = this.calques[0].entrees;
    this._accu = CADENCE; // premier rendu dès la première frame
  }

  _creerCalque({ source, reglages = {}, fondu = 'normal', opacite = 1 }, index) {
    const conv = fragmentDe(source);
    if (!conv || conv.problemes?.length) {
      throw new Error(`ISF inconvertible : ${conv?.problemes?.join(' ; ') ?? 'en-tête introuvable'}`);
    }
    let fragment = conv.fragment;
    const uniforms = {
      TIME: { value: 0 },
      RENDERSIZE: { value: new THREE.Vector2(this._res, this._res) }
    };
    for (const e of conv.entrees) uniforms[e.nom] = { value: this._enveloppe(e, e.defaut) };
    if (index > 0) {
      fragment = envelopperCalque(fragment);
      if (!fragment) throw new Error('pas de main() reconnaissable');
      uniforms.isf_opacite = { value: Number.isFinite(opacite) ? opacite : 1 };
      uniforms.isf_mode = { value: MODES_FONDU[fondu] ?? 0 };
    }
    const materiau = new THREE.ShaderMaterial({
      vertexShader: VERTEX_ISF,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: index > 0,
      ...(index > 0 ? fusionDe(fondu) : {})
    });
    const mesh = new THREE.Mesh(this._geometrie, materiau);
    mesh.renderOrder = index; // le fond d'abord, puis chaque calque dans l'ordre
    mesh.frustumCulled = false;
    this._scene.add(mesh);
    const calque = { entrees: conv.entrees, uniforms, materiau, mesh, fondu, opacite };
    this.poserReglages(calque, reglages);
    return calque;
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

  poserReglages(calque, reglages = {}) {
    const valeurs = valeursDe(calque.entrees, reglages);
    for (const e of calque.entrees) this._poserSur(calque, e.nom, valeurs[e.nom]);
  }

  _poserSur(calque, nom, valeur) {
    const u = calque.uniforms[nom];
    if (!u) return;
    const entree = calque.entrees.find((e) => e.nom === nom);
    if (!entree) return;
    if (entree.type === 'color' || entree.type === 'point2D') {
      const v = this._enveloppe(entree, valeur);
      u.value.copy ? u.value.copy(v) : (u.value = v);
    } else {
      u.value = entree.type === 'bool' ? Boolean(valeur) : Number(valeur) || 0;
    }
  }

  /** Applique un jeu de réglages (JSON de l'œuvre, inspecteur en direct) au calque `i`. */
  appliquer(reglages = {}, i = 0) {
    const c = this.calques[i];
    if (c) this.poserReglages(c, reglages);
  }

  /** Pose UNE entrée (liaison audio, curseur de l'inspecteur) du calque `i`. */
  poser(nom, valeur, i = 0) {
    const c = this.calques[i];
    if (c) this._poserSur(c, nom, valeur);
  }

  /** Mode de fondu et opacité d'un calque (le fond n'en a pas). */
  reglerCalque(i, { fondu, opacite } = {}) {
    const c = this.calques[i];
    if (!c || i === 0) return;
    if (fondu !== undefined && fondu !== c.fondu) {
      c.fondu = fondu;
      Object.assign(c.materiau, {
        blending: THREE.NormalBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        ...fusionDe(fondu)
      });
      c.uniforms.isf_mode.value = MODES_FONDU[fondu] ?? 0;
      c.materiau.needsUpdate = true;
    }
    if (opacite !== undefined) {
      c.opacite = opacite;
      c.uniforms.isf_opacite.value = Number.isFinite(opacite) ? opacite : 1;
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
    for (const c of this.calques) if (c) c.uniforms.TIME.value = temps;
    const cibleAvant = renderer.getRenderTarget();
    renderer.setRenderTarget(this.cible);
    renderer.render(this._scene, this._camera);
    renderer.setRenderTarget(cibleAvant);
    return true;
  }

  dispose() {
    this.cible.dispose();
    for (const c of this.calques) c?.materiau.dispose();
    this._geometrie.dispose();
  }
}
