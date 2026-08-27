import * as THREE from 'three';
import { FOG_DENSITY, silhouetteOuverture, planMur, ancrageBaie }
  from './RoomManager.js';
import { estFluide, materiauFluide } from './style.js';

/**
 * Le CARREAU d'une apparition — à la silhouette de sa baie.
 *
 * Logée dans une ouverture, l'apparition doit en épouser la découpe : une
 * baie oblongue (mode fluide) laissait voir les quatre coins d'un carreau
 * rectangulaire, et l'ailleurs semblait collé de travers sur le mur. On
 * reprend donc le contour même de la baie — la fonction qui sert déjà à
 * la dessiner dans la coque — puis on recentre, et on remet les UV à
 * l'échelle du carreau : la cible de rendu se lit toujours de 0 à 1.
 *
 * Sans baie (apparition en applique), un simple plan : c'est un tableau
 * suspendu, il n'a pas de découpe à suivre.
 */
function geometrieDeBaie(room, cfg, baie, bw, bh) {
  let forme = null;
  if (baie) {
    const plan = planMur(room.config.shell, cfg.wall ?? 'nord');
    forme = plan && silhouetteOuverture(baie, plan.length, plan.height);
  } else if (estFluide()) {
    // Apparition EN APPLIQUE — elle ne remplit aucune ouverture, elle est
    // posée sur un mur plein. Rectangulaire, elle redevenait la fenêtre
    // d'avant au milieu d'une galerie qui n'en a plus : c'est la baie que
    // l'auteur voyait « avec l'ancien design » aux archives. On lui donne
    // la même silhouette qu'à une vraie baie, en la décrivant comme telle.
    forme = silhouetteOuverture(
      { shape: 'rect', offset: 0, width: bw, height: bh, sill: 0 },
      bw * 4, bh * 4);
  }
  if (!forme) return new THREE.PlaneGeometry(bw, bh);
  const geo = new THREE.ShapeGeometry(forme, 24);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
  const lx = Math.max(1e-4, b.max.x - b.min.x), ly = Math.max(1e-4, b.max.y - b.min.y);
  geo.translate(-cx, -cy, 0);
  // ShapeGeometry pose ses UV en MÈTRES (les coordonnées de la forme) :
  // sans ce recadrage, la lucarne montrerait un texel étiré de la cible
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - b.min.x) / lx, (uv.getY(i) - b.min.y) / ly);
  }
  uv.needsUpdate = true;
  // le carreau déborde d'un chouia, comme le plan qu'il remplace
  geo.scale(bw / lx, bh / ly, 1);
  return geo;
}

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
 * `"frame": false` — l'apparition REMPLIT une vraie ouverture de la coque
 * au lieu de se poser en applique : déclarez la même géométrie dans
 * `shell.windows` et dans `vistas`, et la fenêtre cesse de donner sur le
 * vide pour donner sur une pièce. Le carreau se loge alors dans
 * l'épaisseur du mur, encadré par le dormant de la coque — pas de second
 * cadre par-dessus le premier.
 *
 * Deux régimes, jamais le vide :
 *  - GPU costaud : rendu VIVANT, une apparition par frame paire, la
 *    parallaxe suit le pas du visiteur ;
 *  - GPU modeste ou mobile : rendu LENT — la baie est peinte à l'entrée
 *    dans la pièce, puis rafraîchie seulement quand le visiteur s'est
 *    déplacé d'un bon mètre, et au plus une fois par seconde. La
 *    parallaxe traîne, mais on VOIT la pièce d'à côté ; une baie noire ne
 *    raconte rien.
 * Seule une baie hors de portée, vue de dos ou dont la pièce cible manque
 * reste éteinte.
 */

// La baie doit AFFLEURER côté intérieur : le mur fait 0.35 d'épaisseur
// (demi-épaisseur 0.175) — plus près du plan du mur, elle disparaîtrait
// dans sa masse.
const INSET = 0.26;

// Régime lent : une image par seconde au plus, et seulement si le visiteur
// s'est déplacé d'un bon mètre — en deçà, la précédente vaut encore.
const SLOW_PERIOD = 1;
const SLOW_MOVE2 = 1;      // m²
const SLOW_MIN = 0.15;     // s — étale la peinture initiale de plusieurs baies

const _mat = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _matFrustum = new THREE.Matrix4();
const _invCam = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/**
 * Sphère englobant une baie, centrée sur son mesh : la demi-diagonale du
 * carreau. La marge fait entrer la baie dans le champ un peu avant qu'on
 * la voie — mieux vaut peindre une frame pour rien que montrer une image
 * périmée au bord de l'écran pendant une rotation.
 */
function rayonBaie(v) {
  // les dimensions POSÉES, pas celles écrites : une apparition qui a adopté
  // sa baie n'a plus la taille de sa propre configuration
  return Math.hypot(v.bw ?? v.cfg.width ?? 4, v.bh ?? v.cfg.height ?? 2.2) / 2 + 0.5;
}

export class VistaManager {
  constructor(app) {
    this.app = app;
    // vivant (chaque frame paire) seulement là où le GPU suit ; le
    // gouverneur peut couper — on retombe alors sur le rendu lent, pas
    // sur le noir
    this.live = app.quality.profile.tier === 'desktop';
    this._camera = new THREE.PerspectiveCamera(60, 1, 0.05, 220);
    this._fog = new THREE.Color();
    this._bg = new THREE.Color();
    this._slow = 0;                 // secondes depuis le dernier rendu lent
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
    // baie « en applique » (par défaut) ou carreau logé dans une ouverture
    // de la coque : le carreau recule au plan médian du mur et déborde de
    // deux centimètres, si bien qu'aucun jour ne se voit sur les bords.
    const fill = cfg.frame === false;
    const inset = fill ? 0 : INSET;
    const offset = cfg.offset ?? 0;

    // L'APPARITION SUIT SA BAIE, elle ne la répète pas.
    //
    // Une apparition « logée » (frame: false) remplit une ouverture de la
    // coque, mais elle portait sa PROPRE largeur, hauteur et appui. Deux
    // descriptions du même trou : au premier changement de baie elles ont
    // divergé, et le carreau s'est retrouvé de travers dans son ouverture.
    // On adopte donc la baie du même mur au même décalage — sa géométrie
    // ET sa silhouette, qui n'est plus forcément un rectangle (oblong en
    // mode fluide). Sans baie correspondante, l'apparition reste ce
    // qu'elle a toujours été : un carreau en applique.
    const baieDeLaCoque = fill
      ? (shell.windows ?? []).find((o) => (o.wall ?? 'nord') === (cfg.wall ?? 'nord')
        && Math.abs((o.offset ?? 0) - offset) < 0.01)
      : null;
    // dimensions NOMINALES du trou (sans le débord) : c'est sur elles que
    // se calcule le centre, sinon le carreau se centre sur une hauteur qui
    // n'est pas la sienne et se pose de travers dans son ouverture
    const bwNom = baieDeLaCoque?.width ?? cfg.width ?? 4;
    const bhNom = baieDeLaCoque?.height ?? cfg.height ?? 2.2;
    const bw = bwNom + (fill ? 0.04 : 0);
    const bh = bhNom + (fill ? 0.04 : 0);
    const sill = baieDeLaCoque?.sill ?? cfg.sill ?? 1;

    // Où se pose le carreau : L'ANCRAGE DE LA COQUE, pas une table
    // parallèle. Les apparitions tenaient la leur, qui inversait sud et
    // ouest — sur un mur ouest de couloir, le carreau se posait quatre
    // mètres à côté de son trou. `inset` décolle ensuite l'applique de la
    // paroi, le long de la normale intérieure.
    const ROT = { nord: 0, sud: 180, est: -90, ouest: 90 };
    const wall = cfg.wall ?? 'nord';
    const a = ancrageBaie(room.config.shell, wall, offset);
    if (!a || ROT[wall] === undefined) return null;
    const f = {
      pos: [a.x + a.normale[0] * inset, 0, a.z + a.normale[1] * inset],
      rotY: ROT[wall]
    };

    let material, rt = null;
    if (this.app.renderer) {
      // Résolution volontairement modeste : l'apparition est une lucarne
      // vers ailleurs, pas un miroir 4K — et chaque texel se paie à chaque
      // rendu. Le léger flou participe d'ailleurs à l'irréel. En régime
      // lent, on descend encore : l'image tient plus longtemps à l'écran,
      // autant qu'elle coûte moins cher à peindre.
      const px = this.live
        ? Math.min(96, 512 / Math.max(bw, bh))
        : Math.min(48, 256 / Math.max(bw, bh));
      rt = new THREE.WebGLRenderTarget(
        Math.max(2, Math.round(bw * px)), Math.max(2, Math.round(bh * px)),
        { samples: 0 }
      );
      rt.texture.colorSpace = this.app.renderer.outputColorSpace;
      material = new THREE.MeshBasicMaterial({ map: rt.texture });
      // le rendu de la passe a déjà son exposition : pas de double tone mapping
      material.toneMapped = false;
    } else {
      // sans renderer (tests hors navigateur) : plaque teintée de la cible
      const target = this.app.rooms?.get?.(cfg.room);
      material = new THREE.MeshStandardMaterial({
        color: 0x05050c,
        emissive: new THREE.Color(target?.config.fogColor ?? '#151528'),
        emissiveIntensity: 0.9,
        roughness: 0.3, metalness: 0.4
      });
    }

    const mesh = new THREE.Mesh(
      geometrieDeBaie(room, cfg, baieDeLaCoque, bw, bh), material);
    // le centre reste celui de la baie NOMINALE : le débord se répartit
    mesh.position.set(f.pos[0], sill + bhNom / 2, f.pos[2]);
    mesh.rotation.y = THREE.MathUtils.degToRad(f.rotY);
    mesh.userData.ignoreRaycast = true;
    mesh.name = `apparition-${cfg.room}`;

    // Cadre : sans lui, l'apparition posée sur un mur plein se lit comme
    // une tache — avec lui, comme une baie. Teinte de portail : c'est de
    // la même magie. Un carreau logé dans une ouverture, lui, a déjà le
    // dormant de la coque : un second cadre ferait doublon.
    if (!fill) {
      const T = 0.14, D = 0.3;
      if (estFluide()) {
        // le même anneau adouci que les portails et les dormants de baie :
        // quatre barreaux droits autour d'un carreau oblong auraient remis
        // les angles durs qu'on vient de retirer partout
        const dehors = silhouetteOuverture(
          { shape: 'rect', offset: 0, width: bw + 2 * T, height: bh + 2 * T, sill: 0 },
          (bw + 2 * T) * 4, (bh + 2 * T) * 4);
        const dedans = silhouetteOuverture(
          { shape: 'rect', offset: 0, width: bw, height: bh, sill: 0 },
          bw * 4, bh * 4);
        if (dehors && dedans) {
          dehors.holes.push(new THREE.Path(dedans.getPoints(48)));
          const anneau = new THREE.Mesh(
            new THREE.ExtrudeGeometry(dehors,
              { depth: D, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05,
                bevelSegments: 2, curveSegments: 24 }),
            materiauFluide());
          anneau.geometry.center();
          anneau.userData.ignoreRaycast = true;
          mesh.add(anneau);
        }
      } else {
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0x241f38, roughness: 0.5, metalness: 0.3,
          emissive: 0x9f8cff, emissiveIntensity: 0.35
        });
        const bar = (bx, by, x, y) => {
          const b = new THREE.Mesh(new THREE.BoxGeometry(bx, by, D), frameMat);
          b.position.set(x, y, 0);
          b.userData.ignoreRaycast = true;
          mesh.add(b);
        };
        // les barreaux MORDENT sur la baie (T/2 au lieu de T) : deux faces
        // qui se touchent exactement grésillent, deux faces qui s'emboîtent
        // se tiennent tranquilles
        bar(bw + 2 * T, T, 0, bh / 2 + T / 4);
        bar(bw + 2 * T, T, 0, -bh / 2 - T / 4);
        bar(T, bh, -bw / 2 - T / 4, 0);
        bar(T, bh, bw / 2 + T / 4, 0);
      }
    }
    // `camAt` : d'où la baie a été peinte la dernière fois — null tant
    // qu'elle ne l'a jamais été (elle passe alors en tête de file)
    // `bw`/`bh` : les dimensions RÉELLEMENT posées (celles de la baie quand
    // l'apparition en remplit une). La caméra de rendu doit s'y accorder,
    // sinon l'ailleurs est étiré dans son ouverture — c'est le décalage qui
    // restait visible au couloir après avoir pourtant recalé la découpe.
    return { cfg, mesh, rt, camAt: null, bw, bh };
  }

  /**
   * Rend UNE apparition de la pièce courante par frame, en alternance :
   * un mur peut en porter plusieurs, chacune reste vivante, le coût reste
   * celui d'un seul rendu. Appelé par la boucle de l'App AVANT le rendu
   * principal.
   */
  update(dt = 1 / 60) {
    if (!this.app.renderer) return;
    const rooms = this.app.rooms;
    const current = rooms?.current;
    // pas de rendu d'apparition pendant un warp : la frame est déjà chère,
    // et l'image est de toute façon tordue par la passe — repeindre une
    // lucarne pendant qu'on traverse un portail, c'est payer pour rien
    if (rooms?._transitioning || this.app.warpPass?.enabled) return;
    const camWorld = this.app.camera;
    // Le champ de vision se calcule sur la position de CETTE frame : la
    // matrice inverse que garde le moteur date du rendu précédent, et
    // pendant une rotation vive elle ferait juger une baie sur un regard
    // qu'on n'a plus.
    camWorld.updateMatrixWorld();
    _invCam.copy(camWorld.matrixWorld).invert();
    _matFrustum.multiplyMatrices(camWorld.projectionMatrix, _invCam);
    _frustum.setFromProjectionMatrix(_matFrustum);
    const vistas = (current?.vistas ?? []).filter((v) => {
      if (!v.rt) return false;
      // hors de portée ou vue de dos : rien à rafraîchir
      v.mesh.getWorldPosition(_pos);
      if (_pos.distanceToSquared(camWorld.position) > 1600) return false;
      _dir.set(0, 0, 1).transformDirection(v.mesh.matrixWorld);
      _toCam.copy(camWorld.position).sub(_pos);
      if (_dir.dot(_toCam) <= 0) return false;
      // Debout dans une pièce, on est DEVANT tous ses murs à la fois : le
      // produit scalaire ne dit donc rien de ce qu'on regarde, et le tour
      // de rôle repeignait une pièce entière dans la RTT pour une baie
      // qu'on avait dans le dos. Une baie DÉJÀ peinte attend d'être
      // regardée ; une baie neuve garde sa priorité, sinon elle resterait
      // noire jusqu'à ce qu'on la trouve.
      if (!v.camAt) return true;
      _sphere.center.copy(_pos);
      _sphere.radius = rayonBaie(v);
      return _frustum.intersectsSphere(_sphere);
    });
    if (!vistas.length) return;

    let vista;
    if (this.live) {
      // une frame sur deux suffit : l'œil pardonne 30 Hz à une lucarne,
      // pas une galerie qui saccade
      this._beat = !this._beat;
      if (this._beat) return;
      this._turn = ((this._turn ?? -1) + 1) % vistas.length;
      vista = vistas[this._turn];
    } else {
      // régime lent : d'abord les baies jamais peintes (elles sont noires),
      // ensuite celles dont le point de vue a vraiment changé
      this._slow += dt;
      // même les baies neuves attendent leur tour : peindre trois pièces
      // dans trois frames consécutives fait décrocher l'entrée dans une
      // salle, là où les étaler sur une demi-seconde ne se voit pas
      if (this._slow < SLOW_MIN) return;
      const neuve = vistas.find((v) => !v.camAt);
      if (neuve) {
        vista = neuve;
      } else if (this._slow >= SLOW_PERIOD) {
        vista = vistas.find(
          (v) => v.camAt.distanceToSquared(camWorld.position) > SLOW_MOVE2
        );
      }
      if (!vista) return;
      this._slow = 0;
    }
    // une baie sans pièce cible ne sera jamais peinte : on la marque quand
    // même, sinon elle repasserait en tête de file à chaque frame et
    // affamerait les autres
    vista.camAt = (vista.camAt ?? new THREE.Vector3()).copy(camWorld.position);
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
    this._camera.aspect = (vista.bw ?? vista.cfg.width ?? 4)
      / (vista.bh ?? vista.cfg.height ?? 2.2);
    this._camera.updateProjectionMatrix();

    // la pièce cible prend la scène le temps d'une passe
    const scene = this.app.scene;
    const renderer = this.app.renderer;
    this._fog.copy(scene.fog.color);
    this._bg.copy(scene.background);
    const fogDensity = scene.fog.density;
    const targetFog = target.config.fogColor;
    if (targetFog) {
      scene.fog.color.set(targetFog);
      scene.background.set(targetFog);
    }
    // la DENSITÉ aussi : un jardin clair (0,009) rendu au brouillard d'une
    // petite salle (0,026) baignait dans un lait bleu — la fenêtre doit
    // montrer la pièce telle qu'on la trouve en y entrant
    const td = Number(target.config.fogDensity);
    scene.fog.density = Number.isFinite(td) && td >= 0 ? td : FOG_DENSITY;
    current.group.visible = false;
    target.group.visible = true;

    renderer.setRenderTarget(vista.rt);
    renderer.render(scene, this._camera);
    renderer.setRenderTarget(null);

    target.group.visible = false;
    current.group.visible = true;
    scene.fog.color.copy(this._fog);
    scene.background.copy(this._bg);
    scene.fog.density = fogDensity;
  }
}
