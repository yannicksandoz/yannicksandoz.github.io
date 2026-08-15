import * as THREE from 'three';
import { SHELL_DEFAULTS } from './RoomManager.js';

/**
 * Apparitions — une pièce d'ailleurs, vivante, sur un plan de la pièce
 * courante.
 *
 * Une apparition est une baie posée sur un mur (comme une fenêtre, mêmes
 * clés : wall/offset/width/height/sill) mais qui ne donne pas sur l'espace :
 * elle montre une AUTRE pièce, rendue chaque frame dans une texture depuis
 * une caméra ancrée là-bas. La caméra suit les déplacements du visiteur
 * (parallaxe) : bouger devant la baie déplace le point de vue dans la pièce
 * apparue — l'illusion d'une ouverture, pas d'un tableau.
 *
 *   "vistas": [ { "room": "jardin", "wall": "nord", "offset": 0,
 *                 "width": 5, "height": 2.4, "sill": 0.9,
 *                 "anchor": { "position": [0, 1.8, 10], "rotationY": 180 } } ]
 *
 * `anchor` place la baie « côté pièce apparue » : où elle s'ouvrirait si
 * elle existait là-bas (défaut : le point d'apparition de la pièce).
 *
 * Coût : UN rendu supplémentaire par frame (l'apparition la plus proche
 * seulement). Sur mobile et GPU faibles, pas de rendu vivant : la baie
 * devient une plaque sombre teintée de la pièce cible — l'apparition
 * attend un meilleur écran.
 */

// La baie doit AFFLEURER côté intérieur : le mur fait 0.35 d'épaisseur
// (demi-épaisseur 0.175) — plus près du plan du mur, elle disparaîtrait
// dans sa masse.
const INSET = 0.26;

const _mat = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();

export class VistaManager {
  constructor(app) {
    this.app = app;
    // vivant seulement là où le GPU suit ; le gouverneur peut couper
    this.live = app.quality.profile.tier === 'desktop';
    this._camera = new THREE.PerspectiveCamera(60, 1, 0.05, 220);
    this._fog = new THREE.Color();
    this._bg = new THREE.Color();
  }

  /** Construit les apparitions déclarées par une pièce (dans son groupe). */
  build(room) {
    room.vistas = [];
    for (const cfg of room.config.vistas ?? []) {
      const vista = this._create(room, cfg);
      if (vista) {
        room.group.add(vista.mesh);
        room.vistas.push(vista);
      }
    }
  }

  dispose(room) {
    for (const v of room.vistas ?? []) {
      v.mesh.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose?.();
        o.material?.dispose?.();
      });
      v.rt?.dispose();
    }
    room.vistas = [];
  }

  _create(room, cfg) {
    const shell = room.config.shell && room.config.shell !== true
      ? room.config.shell : {};
    const w = Number(shell.width) > 0 ? shell.width : SHELL_DEFAULTS.width;
    const d = Number(shell.depth) > 0 ? shell.depth : SHELL_DEFAULTS.depth;
    const bw = cfg.width ?? 4;
    const bh = cfg.height ?? 2.2;
    const sill = cfg.sill ?? 1;
    const offset = cfg.offset ?? 0;

    // cadre local de la baie sur son mur, +Z vers l'intérieur de la pièce
    const FRAMES = {
      nord: { pos: [offset, 0, -d / 2 + INSET], rotY: 0 },
      sud: { pos: [-offset, 0, d / 2 - INSET], rotY: 180 },
      est: { pos: [w / 2 - INSET, 0, offset], rotY: -90 },
      ouest: { pos: [-w / 2 + INSET, 0, -offset], rotY: 90 }
    };
    const f = FRAMES[cfg.wall ?? 'nord'];
    if (!f) return null;

    let material, rt = null;
    if (this.live && this.app.renderer) {
      // Résolution volontairement modeste : l'apparition est une lucarne
      // vers ailleurs, pas un miroir 4K — et chaque texel se paie à chaque
      // frame. Le léger flou participe d'ailleurs à l'irréel.
      const px = Math.min(96, 512 / Math.max(bw, bh));
      rt = new THREE.WebGLRenderTarget(
        Math.round(bw * px), Math.round(bh * px),
        { samples: 0 }
      );
      rt.texture.colorSpace = this.app.renderer.outputColorSpace;
      material = new THREE.MeshBasicMaterial({ map: rt.texture });
      // le rendu de la passe a déjà son exposition : pas de double tone mapping
      material.toneMapped = false;
    } else {
      // repli : plaque sombre teintée de la pièce cible — l'apparition dort
      const target = this.app.rooms?.get?.(cfg.room);
      material = new THREE.MeshStandardMaterial({
        color: 0x05050c,
        emissive: new THREE.Color(target?.config.fogColor ?? '#151528'),
        emissiveIntensity: 0.9,
        roughness: 0.3, metalness: 0.4
      });
    }

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), material);
    mesh.position.set(f.pos[0], sill + bh / 2, f.pos[2]);
    mesh.rotation.y = THREE.MathUtils.degToRad(f.rotY);
    mesh.userData.ignoreRaycast = true;
    mesh.name = `apparition-${cfg.room}`;

    // Cadre : sans lui, l'apparition se lit comme une tache — avec lui,
    // comme une baie. Teinte de portail : c'est de la même magie.
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x241f38, roughness: 0.5, metalness: 0.3,
      emissive: 0x9f8cff, emissiveIntensity: 0.35
    });
    const T = 0.14, D = 0.3;
    const bar = (bx, by, x, y) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bx, by, D), frameMat);
      b.position.set(x, y, 0);
      b.userData.ignoreRaycast = true;
      mesh.add(b);
    };
    bar(bw + 2 * T, T, 0, bh / 2 + T / 2);   // linteau
    bar(bw + 2 * T, T, 0, -bh / 2 - T / 2);  // appui
    bar(T, bh, -bw / 2 - T / 2, 0);          // montants
    bar(T, bh, bw / 2 + T / 2, 0);
    return { cfg, mesh, rt };
  }

  /**
   * Rend UNE apparition de la pièce courante par frame, en alternance :
   * un mur peut en porter plusieurs, chacune reste vivante, le coût reste
   * celui d'un seul rendu. Appelé par la boucle de l'App AVANT le rendu
   * principal.
   */
  update() {
    if (!this.live || !this.app.renderer) return;
    const rooms = this.app.rooms;
    const current = rooms?.current;
    // pas de rendu d'apparition pendant un warp : la frame est déjà chère
    if (rooms?._transitioning) return;
    // une frame sur deux suffit : l'œil pardonne 30 Hz à une lucarne,
    // pas une galerie qui saccade
    this._beat = !this._beat;
    if (this._beat) return;
    const camWorld = this.app.camera;
    const vistas = (current?.vistas ?? []).filter((v) => {
      if (!v.rt) return false;
      // hors de portée ou vue de dos : rien à rafraîchir
      v.mesh.getWorldPosition(_pos);
      if (_pos.distanceToSquared(camWorld.position) > 1600) return false;
      _dir.set(0, 0, 1).transformDirection(v.mesh.matrixWorld);
      _toCam.copy(camWorld.position).sub(_pos);
      return _dir.dot(_toCam) > 0;
    });
    if (!vistas.length) return;

    this._turn = ((this._turn ?? -1) + 1) % vistas.length;
    const vista = vistas[this._turn];
    const target = rooms.get(vista.cfg.room);
    if (!target || target === current) return;

    // pose de la caméra : ancre ∘ baie⁻¹ ∘ caméra du visiteur — le
    // déplacement devant la baie devient déplacement derrière l'ancre
    const a = vista.cfg.anchor ?? {};
    const anchorPos = a.position ?? target.config.spawn ?? [0, 2, 8];
    _mat.makeRotationY(THREE.MathUtils.degToRad(a.rotationY ?? 0));
    _mat.setPosition(anchorPos[0], anchorPos[1] ?? 0, anchorPos[2]);
    vista.mesh.updateWorldMatrix(true, false);
    _inv.copy(vista.mesh.matrixWorld).invert();
    _mat.multiply(_inv).multiply(camWorld.matrixWorld);
    _mat.decompose(this._camera.position, this._camera.quaternion, _scale);
    this._camera.fov = camWorld.fov;
    this._camera.aspect = (vista.cfg.width ?? 4) / (vista.cfg.height ?? 2.2);
    this._camera.updateProjectionMatrix();

    // la pièce cible prend la scène le temps d'une passe
    const scene = this.app.scene;
    const renderer = this.app.renderer;
    this._fog.copy(scene.fog.color);
    this._bg.copy(scene.background);
    const targetFog = target.config.fogColor;
    if (targetFog) {
      scene.fog.color.set(targetFog);
      scene.background.set(targetFog);
    }
    current.group.visible = false;
    target.group.visible = true;

    renderer.setRenderTarget(vista.rt);
    renderer.render(scene, this._camera);
    renderer.setRenderTarget(null);

    target.group.visible = false;
    current.group.visible = true;
    scene.fog.color.copy(this._fog);
    scene.background.copy(this._bg);
  }
}
