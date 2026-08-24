import * as THREE from 'three';
import { assetUrl, isWalkable } from './utils.js';
import { buildSky, disposeSky, updateSkyUniforms } from './Sky.js';
import { styleTexture, scaleBoxUV, scalePlaneUV, scaleWorldUV, TILE } from './textures.js';
import { delaiDe, fermer, estFerme, tick as tickCooldown } from './Cooldown.js';

const PORTAL_COLOR = 0x9f8cff;
/** Densité de brouillard par défaut — celle d'une salle d'exposition. */
export const FOG_DENSITY = 0.026;
const REARM_DIST2 = 7; // (m²) zone à quitter pour réarmer un portail d'arrivée
const HAUTEUR_CORPS = 2.2; // des pieds aux yeux : ce qui traverse une sphère
const _worldPos = new THREE.Vector3(); // tampons du test de proximité
const _qTour = new THREE.Quaternion(); // rotation du regard pendant une bascule
const _regard = new THREE.Vector3();
const _cap = new THREE.Vector3();

/**
 * Où regarder une fois la gravité retournée — rendu comme la ROTATION à
 * appliquer au regard actuel, pour qu'elle s'anime au lieu de claquer.
 *
 * L'ancienne règle était « le regard garde sa direction, c'est le monde qui
 * tourne ». Élégante sur le papier, désorientante en pratique : on arrivait
 * le nez dans ses chaussures ou dans le plafond selon ce qu'on regardait en
 * entrant dans l'anneau, et le cap semblait tourner au hasard — il tournait
 * en fait d'exactement ce dont la pièce avait tourné, ce qui ne se devine
 * pas de l'intérieur.
 *
 * Deux principes désormais, et ils se voient :
 *   • le regard SUIT LA PIÈCE — le mur qu'on avait en face reste en face,
 *     c'est lui qui donne le sens de l'espace ;
 *   • il se repose sur L'HORIZON — après une bascule on veut voir devant
 *     soi, jamais ses pieds.
 */
function capApresBascule(dir) {
  // « Toujours sur le nouvel horizon, et droit devant » : le cap du monde ne
  // bouge pas d'un degré, seule l'inclinaison se couche. Faire voyager le
  // regard dans la rotation de la pièce — ce que faisait la version d'avant —
  // ajoutait un virage que rien ne demandait : c'est de là que venait le
  // « des fois ça tourne à gauche ». Les caps cardinaux y survivaient par
  // hasard, les autres non.
  const fin = _cap.set(dir.x, 0, dir.z);
  if (fin.lengthSq() < 1e-8) fin.set(0, 0, -1);  // regard vertical : cap par défaut
  return new THREE.Quaternion().setFromUnitVectors(dir, fin.normalize());
}
const _worldUp = new THREE.Vector3();
const _proj = new THREE.Vector3();     // direction caméra → portail
const _vers = new THREE.Vector3();     // direction vers le portail
const _avant = new THREE.Vector3();    // où regarde la caméra
const _frustum = new THREE.Frustum();  // champ de vision
const _matFrustum = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/**
 * Système de pièces connectées.
 *
 * Chaque pièce (rooms/*.json) possède : un groupe Three.js (une seule pièce
 * visible à la fois — culling par pièce), une liste d'œuvres, des portails
 * vers d'autres pièces, et une ambiance audio propre fondue selon la pièce
 * active.
 *
 * Politique de chargement : la pièce courante et ses voisines directes (via
 * portails) sont chargées ; tout le reste est libéré (visuels, sources,
 * buffers) — voir Artwork.forceUnload().
 *
 * Franchir un portail (proximité ou clic en mode visite) déclenche une
 * transition en fondu puis téléporte la caméra au point d'arrivée.
 */
export class RoomManager {
  constructor(app) {
    this.app = app;
    this.rooms = new Map();
    this.current = null;
    this._transitioning = false;
    this._cooldown = 0;
    // passages en cours de réarmement (portails et anneaux, toutes pièces
    // confondues) : ils se vident d'eux-mêmes à l'expiration
    this._refroidis = new Set();
    // position de la caméra à la frame précédente : c'est elle qui dit si
    // l'on VA VERS un portail ou si l'on s'en écarte (voir _vaVers)
    this._camPrec = new THREE.Vector3();
    this._dep = new THREE.Vector3();
    this.fadeEl = document.getElementById('room-fade');
  }

  /* ------------------------------------------------------------ pièces --- */

  addRoom(config) {
    const room = {
      config,
      group: new THREE.Group(),
      artworks: [],
      portalMeshes: [],
      ambience: null, // { bus, sources: [] }
      state: 'far'
    };
    Object.defineProperty(room, 'isCurrent', { get: () => this.current === room });
    room.plane = 'sol';
    room.group.visible = false;
    room.floor = buildFloor(config);
    if (room.floor) room.group.add(room.floor);
    room.shell = buildShell(config);
    if (room.shell) room.group.add(room.shell);
    room.keyLight = buildKeyLight(config, this.app.quality?.profile);
    if (room.keyLight) room.group.add(room.keyLight);
    room.ambient = buildAmbient(config);
    if (room.ambient) room.group.add(room.ambient);
    room.basculeMeshes = buildBascules(config);
    for (const m of room.basculeMeshes) room.group.add(m);
    room.sky = buildSky(config);
    if (room.sky) room.group.add(room.sky);
    this.app.vistas?.build(room);
    this.app.scene.add(room.group);
    this.rooms.set(config.id, room);
    return room;
  }

  /**
   * Réapplique la lumière clé d'une pièce après édition — sur place quand
   * c'est possible (couleur, intensité, orientation : pas de réallocation
   * de carte d'ombre), reconstruction seulement si elle apparaît/disparaît.
   */
  applyKeyLight(room) {
    const cfg = room.config;
    this.applyAmbient(room);
    const wanted = cfg.keyLight !== false;
    // les ombres se décident par pièce (défaut : le profil) — les activer
    // ou les couper alloue/libère une carte d'ombre : on reconstruit
    const ombresVoulues = Boolean(this.app.quality?.profile?.shadows)
      && cfg.keyLight?.shadows !== false;
    if (room.keyLight && ombresVoulues !== room.keyLight.userData.ombres) {
      room.group.remove(room.keyLight);
      disposeKeyLight(room.keyLight);
      room.keyLight = null;
    }
    if (wanted !== Boolean(room.keyLight)) {
      if (room.keyLight) {
        room.group.remove(room.keyLight);
        disposeKeyLight(room.keyLight);
      }
      room.keyLight = buildKeyLight(cfg, this.app.quality?.profile);
      if (room.keyLight) room.group.add(room.keyLight);
      return;
    }
    if (room.keyLight) orientKeyLight(room.keyLight, cfg);
    // le soleil du dôme est un uniform : il suit la lumière clé sans
    // reconstruction — le ciel et les ombres racontent la même heure
    if (room.sky) updateSkyUniforms(room.sky, cfg);
    if (room.isCurrent) this.applyEnvIntensity(room);
  }

  /** Règle la lumière ambiante d'une pièce sur place (création/retrait compris). */
  applyAmbient(room) {
    const a = room.config.ambient;
    const voulue = Boolean(a) && Number(a.intensity) > 0;
    if (voulue !== Boolean(room.ambient)) {
      if (room.ambient) { room.group.remove(room.ambient); room.ambient.dispose(); }
      room.ambient = buildAmbient(room.config);
      if (room.ambient) room.group.add(room.ambient);
      return;
    }
    if (room.ambient) {
      room.ambient.color.set(a.color ?? '#ffffff');
      room.ambient.intensity = a.intensity;
    }
  }

  /**
   * Oriente une pièce pour qu'un de ses plans devienne le sol — le cœur
   * des espaces à la Escher. On ne penche jamais la caméra : c'est la
   * PIÈCE entière (groupe Three.js) qui tourne, puis se translate pour
   * que la surface visée repose à y = 0. La gravité, les contrôles et le
   * regard du visiteur ne changent pas ; c'est le monde qui a pivoté.
   *
   * `plane` : 'sol' (défaut, identité), 'nord', 'sud', 'est', 'ouest',
   * 'plafond'. Les demi-dimensions viennent de la coque (ou du sol à
   * défaut) : un portail peut donc déposer le visiteur debout sur un mur
   * de la même pièce — les œuvres, elles, pendent désormais de côté.
   */
  orientRoom(room, plane = 'sol') {
    const g = room.group;
    const shell = room.config.shell && room.config.shell !== true
      ? room.config.shell : {};
    const w = Number(shell.width) > 0 ? shell.width : SHELL_DEFAULTS.width;
    const d = Number(shell.depth) > 0 ? shell.depth : SHELL_DEFAULTS.depth;
    const h = Number(shell.height) > 0 ? shell.height : SHELL_DEFAULTS.height;
    const X = new THREE.Vector3(1, 0, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    const ORIENTATIONS = {
      sol: [null, 0, 0],
      nord: [X, -90, d / 2],   // mur du fond (z = -profondeur/2)
      sud: [X, 90, d / 2],
      est: [Z, -90, w / 2],    // mur de droite (x = +largeur/2)
      ouest: [Z, 90, w / 2],
      plafond: [X, 180, h]
    };
    const [axis, angle, lift] = ORIENTATIONS[plane] ?? ORIENTATIONS.sol;
    if (!axis) {
      g.quaternion.identity();
      g.position.set(0, 0, 0);
    } else {
      g.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(angle));
      g.position.set(0, lift, 0);
    }
    g.updateMatrixWorld(true);
    room.plane = plane;
  }

  /**
   * Surfaces sur lesquelles on peut MARCHER dans la pièce courante : le
   * sol, la coque (un mur devenu sol à la Escher se foule), et les objets
   * marqués `walkable: true` — les escaliers. C'est ce que le suivi de
   * sol des contrôles interroge chaque frame.
   */
  walkables() {
    const room = this.current;
    if (!room) return [];
    const list = [];
    if (room.floor) for (const c of room.floor.children) if (c.isMesh) list.push(c);
    room.shell?.traverse((o) => { if (o.isMesh) list.push(o); });
    for (const a of room.artworks) {
      if (!isWalkable(a.config) || !a.mesh) continue;
      // le maillage de collision quand il existe (quelques pavés), sinon le
      // maillage de rendu — voir Artwork._setMesh et voxel.buildVoxelCollider
      list.push(a.collider ?? a.mesh);
    }
    return list;
  }

  /**
   * Ce qui ARRÊTE la marche : tout ce que l'on foule, plus les œuvres
   * PLEINES. Un tableau se contourne — on traversait les panneaux et l'on
   * ressortait derrière le mur qui les porte, dans un espace que personne
   * n'a meublé. Les vitres invisibles des baies sont déjà dans la coque.
   *
   * Liste distincte des `walkables` : celle-ci sert au rayon HORIZONTAL,
   * l'autre au rayon vertical. Un panneau n'est pas un plancher — le mêler
   * aux sols ferait marcher sur les tableaux.
   */
  blockers() {
    const room = this.current;
    if (!room) return [];
    const list = this.walkables();
    for (const a of room.artworks) {
      if (!a.mesh || isWalkable(a.config)) continue;   // déjà foulable
      if (a.config.solid === false) continue;          // passe-muraille assumé
      // les œuvres à PANNEAU (image, vidéo) et celles qu'on déclare pleines
      const plein = a.config.solid === true
        || typeof a.config.image === 'string'
        || typeof a.config.video === 'string';
      if (plein) list.push(a.mesh);
    }
    return list;
  }

  /**
   * Boîte foulable de la pièce courante, en coordonnées LOCALES.
   *
   * Une pièce à ciel ouvert n'a pas de murs pour retenir le visiteur : sans
   * cette borne, on marche au-delà du bord du sol et l'on continue dans le
   * vide, indéfiniment. La limite se prend sur le sol (et sur la coque quand
   * elle est plus large), avec un pas de recul pour ne pas donner sur
   * l'abîme. Renvoie null si la pièce n'a ni sol ni coque — un espace qui
   * assume de n'avoir aucun bord.
   *
   * Les TROIS axes locaux comptent, pas seulement x et z : quand un mur
   * devient le sol (Escher), l'axe local Y n'est plus la verticale mais une
   * direction de marche. Ne borner que x et z laissait alors une fuite —
   * sur le plan nord, on marchait indéfiniment le long de z. La borne
   * verticale est large (la coque, plus six mètres) : elle retient celui qui
   * s'échappe, jamais celui qui gravit un escalier.
   *
   * → { half, yMin, yMax } en mètres, tous en coordonnées locales.
   */
  boundsLocal(room = this.current) {
    const cfg = room?.config;
    if (!cfg) return null;
    let half = 0;
    if (cfg.floor !== false) {
      const s = Number(cfg.floor?.size);
      half = Number.isFinite(s) && s > 0 ? s / 2 : FLOOR_DEFAULTS.size / 2;
    }
    const shell = cfg.shell && cfg.shell !== true ? cfg.shell : (cfg.shell ? {} : null);
    let yMax = Infinity;
    let halfX = null, halfZ = null;
    if (shell) {
      const w = Number(shell.width) > 0 ? shell.width : SHELL_DEFAULTS.width;
      const d = Number(shell.depth) > 0 ? shell.depth : SHELL_DEFAULTS.depth;
      const h = Number(shell.height) > 0 ? shell.height : SHELL_DEFAULTS.height;
      half = Math.max(half, w / 2, d / 2);
      yMax = h + 6;
      // Coque CLOSE (ses quatre murs) : c'est ELLE la limite, par axe, et
      // non le sol — un couloir de 8 m posé sur un sol de 42 laissait
      // dériver le visiteur bien au-delà de ses murs dès qu'il passait une
      // ouverture. Filet de sécurité : même si un rayon manque une vitre,
      // on est ramené dans la pièce au lieu d'errer dehors.
      const murs = shell.walls;
      const close = !Array.isArray(murs)
        || ['nord', 'sud', 'est', 'ouest'].every((m) => murs.includes(m));
      if (close) {
        halfX = Math.max(1.2, w / 2 - 0.6);
        halfZ = Math.max(1.2, d / 2 - 0.6);
      }
    }
    if (!half) return null;
    const carre = Math.max(2, half - 1.5);
    return {
      half: carre,
      halfX: halfX ?? carre,
      halfZ: halfZ ?? carre,
      yMin: -1.5, yMax
    };
  }

  /**
   * Bascule de plan — la transition Escher CONTINUE, réservée aux hauts
   * d'escaliers : pas de warp, pas de fondu — le monde pivote autour du
   * visiteur pendant ~1,6 s, et le mur qu'il longeait devient son sol.
   * La continuité est garantie par la construction : un escalier qui
   * ABOUTIT au mur cible place déjà le visiteur, après rotation, au ras
   * du nouveau sol — la caméra glisse à peine.
   */
  basculer(room, cfg, mesh = null) {
    if (this._transitioning) return;
    this._transitioning = true;
    // le passage se ferme derrière soi (rouge + décompte), comme un portail
    const anneau = mesh
      ?? (room.basculeMeshes ?? []).find((m) => m.userData.bascule === cfg);
    if (anneau && fermer(anneau, delaiDe(cfg, this.app))) this._refroidis.add(anneau);
    this.app.activeFocus?.cancel?.();
    if (this.app.controls) this.app.controls.locked = true;

    const g = room.group;
    const q0 = g.quaternion.clone();
    const p0 = g.position.clone();
    this.orientRoom(room, cfg.plane ?? 'sol'); // mesure l'état final…
    const q1 = g.quaternion.clone();
    const p1 = g.position.clone();
    g.quaternion.copy(q0); // …puis repart de l'état présent
    g.position.copy(p0);
    g.updateMatrixWorld(true);

    const cam = this.app.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this._bascule = {
      room, q0, q1, p0, p1,
      c0: cam.position.clone(),
      c1: new THREE.Vector3(...(cfg.arrival ?? [0, 2.2, 0])),
      dir, tourner: capApresBascule(dir), t: 0, dur: cfg.duration ?? 1.6
    };
  }

  /** Fait avancer la bascule en cours. Rend true tant qu'elle anime. */
  _tickBascule(dt) {
    const b = this._bascule;
    if (!b) return false;
    b.t += dt;
    const k = Math.min(1, b.t / b.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
    b.room.group.quaternion.slerpQuaternions(b.q0, b.q1, e);
    b.room.group.position.lerpVectors(b.p0, b.p1, e);
    b.room.group.updateMatrixWorld(true);
    const cam = this.app.camera;
    cam.position.lerpVectors(b.c0, b.c1, e);
    // Le regard tourne AVEC la pièce, et se repose sur l'horizon (voir
    // `capApresBascule`) : la rotation s'étale sur toute la bascule, pour
    // qu'on la vive comme un basculement et non comme une coupure.
    _qTour.identity().slerp(b.tourner, e);
    _regard.copy(b.dir).applyQuaternion(_qTour);
    this.app.controls?.orbit.target.copy(cam.position).addScaledVector(_regard, 4);
    if (k >= 1) {
      this._bascule = null;
      this._transitioning = false;
      if (this.app.controls) {
        this.app.controls.locked = false;
        this.app.controls.resyncCollision();
      }
      this._cooldown = 1.2;
      this._disarmPortalsNearCamera();
      this._disarmBasculesNearCamera();
    }
    return true;
  }

  _disarmBasculesNearCamera() {
    const cam = this.app.camera.position;
    for (const mesh of this.current?.basculeMeshes ?? []) {
      const r = (mesh.userData.bascule.radius ?? 1.7) * 1.6;
      mesh.getWorldPosition(_worldPos);
      const dx = cam.x - _worldPos.x;
      const dz = cam.z - _worldPos.z;
      mesh.userData.disarmed = (dx * dx + dz * dz) < r * r;
    }
  }

  /** Intensité d'environnement (IBL) : profil de qualité × réglage de pièce. */
  applyEnvIntensity(room = this.current) {
    const scene = this.app.scene;
    if (!('environmentIntensity' in scene)) return;
    const base = this.app.envBaseIntensity ?? 0.5;
    scene.environmentIntensity = base * (room?.config.envIntensity ?? 1);
  }

  /** Reconstruit le sol d'une pièce après édition (taille, couleur, absence). */
  rebuildFloor(room) {
    if (room.floor) {
      room.group.remove(room.floor);
      disposeFloor(room.floor);
      room.floor = null;
    }
    room.floor = buildFloor(room.config);
    if (room.floor) room.group.add(room.floor);
  }

  /**
   * Chemin VIF du ciel : les couleurs, la couverture, la brume et le soleil
   * sont des uniforms — mis à jour en place, sans recréer le matériau (donc
   * sans recompiler le shader à chaque tick de curseur). Reconstruction
   * seulement quand le dôme apparaît ou disparaît.
   */
  applySky(room) {
    const wanted = Boolean(room.config.sky);
    if (wanted !== Boolean(room.sky)) {
      this.rebuildSky(room);
      return;
    }
    if (room.sky) updateSkyUniforms(room.sky, room.config);
  }

  /** Reconstruit le ciel d'une pièce (présence, dimensions de la pièce). */
  rebuildSky(room) {
    if (room.sky) {
      room.group.remove(room.sky);
      disposeSky(room.sky);
      room.sky = null;
    }
    room.sky = buildSky(room.config);
    if (room.sky) room.group.add(room.sky);
  }

  /** Reconstruit la coque (murs) d'une pièce après édition. */
  rebuildShell(room) {
    if (room.shell) {
      room.group.remove(room.shell);
      disposeShell(room.shell);
      room.shell = null;
    }
    room.shell = buildShell(room.config);
    if (room.shell) room.group.add(room.shell);
  }

  /**
   * Réapplique toute l'architecture d'une pièce (sol, coque, lumière clé) —
   * chemin d'édition des dimensions. La lumière clé n'est PAS recréée :
   * réorientée et sa caméra d'ombre recadrée sur le nouveau sol, sans
   * réallouer la carte d'ombre à chaque tick de curseur.
   */
  refreshRoomLook(room) {
    this.rebuildFloor(room);
    this.rebuildShell(room);
    this.rebuildSky(room);
    this.app.vistas?.dispose(room);
    this.app.vistas?.build(room);
    if (room.keyLight) {
      orientKeyLight(room.keyLight, room.config);
      frameKeyLightShadow(room.keyLight, room.config);
    }
    if (room.isCurrent) {
      this.applyEnvIntensity(room);
      this.applyFog(room);
    }
  }

  /**
   * Brouillard de la pièce : teinte et DENSITÉ. La densité compte autant que
   * la couleur — la valeur d'une petite salle (0,026) rend une pièce de
   * quatre-vingts mètres opaque à mi-distance, et l'architecture qui fait
   * tout l'intérêt d'un grand volume disparaît. Chaque pièce choisit donc la
   * sienne (`fogDensity`), à défaut celle du moteur.
   */
  applyFog(room = this.current) {
    const scene = this.app.scene;
    if (!scene?.fog) return;
    const color = room?.config.fogColor;
    if (color) {
      scene.fog.color.set(color);
      scene.background.set(color);
    }
    const d = Number(room?.config.fogDensity);
    scene.fog.density = Number.isFinite(d) && d >= 0 ? d : FOG_DENSITY;
  }

  get(id) {
    return this.rooms.get(id);
  }

  list() {
    return [...this.rooms.values()];
  }

  clear() {
    for (const room of this.rooms.values()) {
      this._releaseAmbience(room);
      for (const m of room.portalMeshes) disposePortalMesh(m);
      if (room.floor) disposeFloor(room.floor);
      if (room.shell) disposeShell(room.shell);
      if (room.keyLight) disposeKeyLight(room.keyLight);
      // Un passage de gravité est tantôt un Mesh (anneau) tantôt un Group
      // (sphère de transfert : coque + sablier) : on parcourt, on ne
      // suppose pas. Supposer coûtait une exception qui interrompait le
      // vidage — donc la reconstruction entière de la scène en édition.
      for (const m of room.basculeMeshes ?? []) {
        m.traverse((o) => {
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) mat?.dispose();
        });
      }
      this.app.vistas?.dispose(room);
      if (room.sky) {
        disposeSky(room.sky);
        room.sky = null;
      }
      room.group.removeFromParent();
    }
    this.rooms.clear();
    this._refroidis.clear();
    this.current = null;
  }

  /* ---------------------------------------------------------- portails --- */

  buildPortals(room) {
    for (const m of room.portalMeshes) {
      room.group.remove(m);
      disposePortalMesh(m);
    }
    room.portalMeshes = [];
    for (const cfg of room.config.portals ?? []) {
      const target = this.rooms.get(cfg.to);
      const mesh = buildPortalMesh(cfg, target?.config.title ?? cfg.to);
      mesh.userData.portal = { room, cfg, mesh };
      room.group.add(mesh);
      room.portalMeshes.push(mesh);
    }
  }

  /**
   * Remet à jour ce que les portes annoncent : « ◆ 1 / 4 » pour la salle
   * qu'elles desservent. Appelé au changement de pièce et à chaque
   * découverte — le compte doit bouger sous les yeux du visiteur, sinon la
   * porte ment jusqu'au prochain passage.
   */
  rafraichirEtiquettes(room = this.current) {
    const prog = this.app.progression;
    if (!room || !prog?.bilanDe) return;
    for (const mesh of room.portalMeshes ?? []) {
      const vers = mesh.userData.portal?.cfg?.to;
      if (vers) peindreEtiquette(mesh, prog.bilanDe(vers));
    }
  }

  /* ------------------------------------------------- pièce courante ----- */

  /**
   * Change de pièce. instant = true pour l'éditeur (pas de fondu).
   * Rend true si le changement a eu lieu, false s'il a été refusé
   * (pièce inconnue ou fondu déjà en cours) — l'appelant ne doit pas
   * annoncer une pièce dans laquelle on n'est jamais entré.
   */
  async setCurrent(id, { instant = false, arrival = null, plane = 'sol' } = {}) {
    const room = this.rooms.get(id);
    if (!room || this._transitioning) return false;

    // Un focus d'œuvre encore en travelling ne survivrait pas au changement :
    // sa pièce cesse d'être mise à jour et il resterait figé, contrôles
    // verrouillés. Résolution instantanée — la caméra est replacée juste après.
    this.app.activeFocus?.cancel?.();

    // Franchir un portail distord l'espace : montée du warp (~0,45 s) vers
    // le noir, téléportation au pic, détente dans la pièce d'arrivée.
    // Sans WebGL ou en mouvement réduit, le fondu simple reste le chemin.
    const warp = !instant && this.app.warpPass && !this.app.quality.reducedMotion;

    if (!instant) {
      this._transitioning = true;
      this.fadeEl?.classList.add('active');
      if (warp) await this._animateWarp(0, 1, 430);
      else await wait(380);
    }

    this.current = room;
    this.orientRoom(room, plane);
    this._applyPolicy();
    this._placeCamera(arrival ?? room.config.spawn ?? [0, 2.2, 10]);
    // Un portail dans lequel on ATTERRIT est désarmé : il ne se re-déclenche
    // qu'une fois sa zone quittée — sinon, arrivée près du portail de retour
    // = renvoi immédiat d'où l'on vient.
    this._disarmPortalsNearCamera();

    if (!instant) {
      await wait(120);
      this.fadeEl?.classList.remove('active');
      if (warp) {
        await this._animateWarp(1, 0, 430);
        this.app.warpPass.enabled = false;
      }
      this._transitioning = false;
      this._cooldown = 1.2; // évite un aller-retour immédiat dans le portail
    }
    return true;
  }

  /** Anime l'uniform du warp entre deux valeurs (easing cubique). */
  _animateWarp(from, to, ms) {
    const pass = this.app.warpPass;
    pass.enabled = true;
    pass.uniforms.uWarp.value = from;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pass.uniforms.uWarp.value = to;
        resolve();
      };
      const t0 = performance.now();
      const step = (now) => {
        if (done) return;
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
        pass.uniforms.uWarp.value = from + (to - from) * e;
        if (k < 1) requestAnimationFrame(step);
        else finish();
      };
      requestAnimationFrame(step);
      // Borne dure : sur un appareil lent les frames s'espacent et le rAF
      // étirerait la traversée — le warp coupe au temps prévu, quoi qu'il
      // arrive. Une frame de marge pour finir proprement.
      setTimeout(finish, ms + 130);
    });
  }

  /** Désarme les portails de la pièce courante trop proches de la caméra. */
  _disarmPortalsNearCamera() {
    const cam = this.app.camera.position;
    for (const mesh of this.current?.portalMeshes ?? []) {
      const p = mesh.localToWorld(_worldPos.set(0, 1.35, 0));
      const dx = cam.x - p.x;
      const dz = cam.z - p.z;
      mesh.userData.disarmed = (dx * dx + dz * dz) < REARM_DIST2;
    }
  }

  _placeCamera(pos) {
    const cam = this.app.camera;
    cam.position.set(pos[0], pos[1], pos[2]);
    // une téléportation n'est pas un pas : sans cela, le saut d'arrivée se
    // lirait comme une enjambée de vingt mètres vers le portail d'en face
    this._camPrec.set(pos[0], pos[1], pos[2]);
    this._dep.set(0, 0, 0);
    // téléportation : la collision doit repartir d'ici, pas d'il y a une frame
    this.app.controls?.resyncCollision?.();
    // Premier regard : une ŒUVRE dans le cadre plutôt que le vide — le
    // visiteur qui apparaît sait immédiatement vers quoi marcher. À défaut
    // (pièce sans œuvre), le centre de la pièce reste le cap.
    const oeuvre = this._oeuvreLaPlusProche(pos);
    const dir = oeuvre
      ? oeuvre.clone().sub(cam.position).setY(0)
      : new THREE.Vector3(-pos[0], 0, -pos[2]);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
    this.app.controls?.orbit.target
      .set(pos[0], pos[1] - 0.2, pos[2])
      .addScaledVector(dir, 4);
  }

  /** Position monde de l'œuvre (role ≠ decor) la plus proche de `pos`. */
  _oeuvreLaPlusProche(pos) {
    const room = this.current;
    if (!room) return null;
    room.group.updateMatrixWorld(true);
    const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const v = new THREE.Vector3();
    let best = null, bestD = Infinity;
    for (const a of room.artworks ?? []) {
      if (a.config.role === 'decor') continue;
      const d = a.group.getWorldPosition(v).distanceTo(p);
      if (d < bestD) { bestD = d; best = v.clone(); }
    }
    return best;
  }

  /**
   * Applique la politique de chargement : courante = visible + active,
   * adjacentes = préchargées mais invisibles, lointaines = libérées.
   */
  _applyPolicy() {
    // Voisines : par portail, et par apparition — une pièce qui apparaît
    // sur un mur doit être chargée pour être rendue.
    const adjacent = new Set([
      ...(this.current?.config.portals ?? []).map((p) => p.to),
      ...(this.current?.config.vistas ?? []).map((v) => v.room)
    ]);
    for (const room of this.rooms.values()) {
      const prev = room.state;
      room.state = room.isCurrent ? 'current'
        : adjacent.has(room.config.id) ? 'adjacent'
        : 'far';
      room.group.visible = room.isCurrent;
      // seule la pièce courante peut être orientée à la Escher : les autres
      // reposent à plat (le rendu des apparitions y compte)
      if (!room.isCurrent && room.plane !== 'sol') this.orientRoom(room, 'sol');

      if (room.state === 'far' && prev !== 'far') {
        for (const a of room.artworks) a.forceUnload();
        this._releaseAmbience(room);
      }
      for (const a of room.artworks) a.setVideoPlaying(room.isCurrent);
      this._updateAmbience(room);
    }
    // ambiance de la pièce (brouillard et éclairage configurables par pièce)
    this.applyFog();
    this.applyEnvIntensity();
    // le badge (haut-gauche) affiche toujours la pièce où l'on se trouve
    this.app.ui?.setRoomTitle?.(
      this.current?.config.title ?? this.current?.config.id);
    // La carte se dessine en marchant : une pièce n'y entre qu'une fois
    // qu'on y est. Ici et pas dans `traverse` — on arrive aussi par le
    // menu, par le catalogue, par la dérive ou par un lien partagé.
    if (this.current) this.app.memoire?.noter('pieces', this.current.config.id);
    // Le compteur d'œuvres est LOCAL à la salle : changer de pièce le change.
    this.rafraichirEtiquettes();
    this.app.progression?._peindre?.();
  }

  /* ---------------------------------------------------------- ambiance --- */

  async _updateAmbience(room) {
    const cfgs = room.config.ambience ?? [];
    if (!cfgs.length || !this.app.audio.unlocked) return;
    if (room.state === 'far') return;

    // Une pièce ADJACENTE créait ses sources et les faisait tourner à gain
    // nul : décodage, mémoire et lecture pour un silence, hors du budget de
    // voix qui protège pourtant les œuvres. Une ambiance ne naît donc que
    // dans la pièce où l'on se trouve — le fondu d'entrée (0,6 s) la porte
    // ensuite sans qu'on l'entende apparaître.
    if (!room.ambience && !room.isCurrent) return;

    if (!room.ambience) {
      room.ambience = { bus: null, sources: [], loading: true };
      try {
        const engine = this.app.audio;
        const buffers = await Promise.all(
          cfgs.map((c) => engine.load(this.app.resolveAsset(c.file)))
        );
        // La pièce a pu être libérée pendant le décodage (changement de
        // pièce, reconstruction de la scène en édition) : on abandonne.
        if (!room.ambience) return;
        const ctx = engine.ctx;
        const bus = ctx.createGain();
        bus.gain.value = 0;
        engine.brancherCanal(bus);   // l'ambiance est une tranche comme une autre
        room.ambience.bus = bus;
        const t0 = ctx.currentTime + 0.05;
        room.ambience.sources = buffers.map((buffer, i) => {
          const gain = ctx.createGain();
          gain.gain.value = cfgs[i].gain ?? 0.5;
          gain.connect(bus);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = true;
          src.connect(gain);
          src.start(t0);
          return { src, gain };
        });
      } catch (err) {
        console.error(`[galerie] Ambiance de « ${room.config.id} » :`, err);
        room.ambience = null;
        return;
      }
    }
    if (room.ambience.bus) {
      const target = room.isCurrent ? 1 : 0;
      room.ambience.bus.gain.setTargetAtTime(
        target, this.app.audio.ctx.currentTime, 0.6
      );
    }
  }

  _releaseAmbience(room) {
    if (!room.ambience) return;
    for (const s of room.ambience.sources) {
      try { s.src.stop(); } catch { /* déjà arrêtée */ }
      s.src.disconnect();
      s.gain.disconnect();
    }
    // La tranche de console de l'ambiance se ferme avec elle : sans cela,
    // son encodeur resterait branché à la somme, pour toujours.
    if (room.ambience.bus) this.app.audio.debrancherCanal(room.ambience.bus);
    room.ambience.bus?.disconnect();
    for (const c of room.config.ambience ?? []) {
      this.app.audio.release(this.app.resolveAsset(c.file));
    }
    room.ambience = null;
  }

  /* ------------------------------------------------------------- cycle --- */

  /**
   * Le portail est-il DANS LE CHAMP ? Un portail hors champ n'est pas une
   * porte, c'est un mur — on ne le franchit pas par surprise.
   *
   * Le test porte sur un VOLUME, pas sur un point : à un mètre du seuil,
   * le centre du portail (1,35 m) passe sous le bas de l'écran — l'œil est
   * 85 cm plus haut — alors que la porte remplit la vue. Un point aurait
   * donc déclaré « invisible » l'instant précis du franchissement. Une
   * sphère qui coiffe le portail dit la vérité de bout en bout.
   *
   * Second garde-fou : le portail doit être DEVANT. Debout dans l'emprise
   * de la sphère, on la voit forcément — même dos tourné ; le produit
   * scalaire, lui, ne se laisse pas prendre.
   */
  _estVisible(centre) {
    const cam = this.app.camera;
    _matFrustum.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_matFrustum);
    _sphere.center.copy(centre);
    _sphere.radius = 1.6;                    // la porte, pas son centre
    if (!_frustum.intersectsSphere(_sphere)) return false;
    cam.getWorldDirection(_avant);
    return _avant.dot(_proj.copy(centre).sub(cam.position)) > 0;
  }

  /**
   * Le pas de cette frame va-t-il VERS ce point ? Reculer dans un portail,
   * ou le longer, ne doit pas le déclencher : seul compte le mouvement qui
   * s'en rapproche. Le déplacement se mesure d'une frame à l'autre, à plat
   * (la hauteur suit le sol, elle ne dit rien de l'intention).
   */
  _vaVers(point, ctx) {
    if (this._dep.lengthSq() < 1e-8) return false; // immobile : rien à franchir
    // On franchit une porte EN AVANÇANT. Reculer dedans passait encore : à
    // l'instant où l'on dépasse le seuil, le portail repasse devant les
    // yeux — vu, et « approché » d'une fraction de frame. Le pas doit donc
    // aller dans le sens du regard, pas seulement vers la porte ; un pas
    // de côté ou en arrière ne franchit rien.
    this.app.camera.getWorldDirection(_avant);
    _avant.setY(0);
    if (this._dep.dot(_avant) <= 0) return false;
    const vers = _vers.copy(point).sub(ctx.cameraPos).setY(0);
    return this._dep.dot(vers) > 0;
  }

  /**
   * Réarme les zones (portails, bascules) que le visiteur a quittées, sans
   * rien déclencher. Le même critère d'hystérésis que la détection : c'est
   * la seule tenue de registre qui doive tourner pendant le temps mort.
   */
  _rearmPass(ctx) {
    for (const mesh of this.current.portalMeshes) {
      if (!mesh.userData.disarmed) continue;
      const p = mesh.localToWorld(_worldPos.set(0, 1.35, 0));
      const dx = ctx.cameraPos.x - p.x, dz = ctx.cameraPos.z - p.z;
      if (dx * dx + dz * dz > REARM_DIST2) mesh.userData.disarmed = false;
    }
    for (const mesh of this.current.basculeMeshes ?? []) {
      if (!mesh.userData.disarmed) continue;
      const r = (mesh.userData.bascule.radius ?? 1.7) * 1.6;
      const c = mesh.getWorldPosition(_worldPos);
      const dx = ctx.cameraPos.x - c.x, dz = ctx.cameraPos.z - c.z;
      if (dx * dx + dz * dz > r * r) mesh.userData.disarmed = false;
    }
  }

  update(dt, ctx) {
    // Dérive des nuages : un temps ACCUMULÉ, borné, poussé avant les
    // temps morts. Trois raisons : un temps absolu claquait tout le motif
    // d'un coup à la (ré)entrée dans la pièce (uTime périmé pendant les
    // early-returns) ; l'accumulation ne compte que le temps passé sous ce
    // ciel ; la borne garde petit l'argument du hash sin() du shader, qui
    // perd sa précision aux grandes valeurs.
    const sky = this.current?.sky;
    if (sky && !this.app.quality.reducedMotion && !this._transitioning) {
      sky.material.uniforms.uTime.value
        = (sky.material.uniforms.uTime.value + dt) % 3600;
    }
    // Déplacement de la frame, relevé AVANT tout retour anticipé : c'est le
    // sens du pas (voir _vaVers), et il doit rester juste même les frames
    // où l'on ne déclenche rien.
    this._dep.copy(ctx.cameraPos).sub(this._camPrec).setY(0);
    this._camPrec.copy(ctx.cameraPos);
    // Délais de réarmement : ils courent même pendant une transition (sans
    // quoi le décompte se figerait le temps du fondu) et même pour les
    // passages de la pièce QUITTÉE — c'est justement celui qu'on vient de
    // franchir qui doit se refermer derrière soi.
    if (this._refroidis.size) tickCooldown(this._refroidis);
    if (this._tickBascule(dt)) return; // une bascule en cours pilote tout
    if (this._cooldown > 0) this._cooldown -= dt;
    if (!this.current || this._transitioning) return;
    // Temps mort d'après-transition : on ne DÉCLENCHE rien, mais on tient
    // quand même le registre des zones désarmées. Sinon un visiteur qui
    // repart aussitôt franchit sa fenêtre de réarmement pendant le temps
    // mort et retrouve l'anneau mort : l'escalier ne marche plus que dans
    // un sens.
    if (this._cooldown > 0) { this._rearmPass(ctx); return; }
    if (this.app.editor?.enabled) return; // pas de téléportation en édition
    // Visite audio : la pièce se change par la LISTE, jamais parce que
    // l'approche d'une œuvre a frôlé un portail — une téléportation
    // non sollicitée serait illisible à l'oreille.
    if (this.app.audioTour?.active) return;

    // Franchissement par proximité — en coordonnées MONDE : une pièce
    // orientée à la Escher a tourné, ses portails aussi. Le test se fait
    // au CENTRE du portail, hauteur comprise : un portail couché sur un
    // mur ou pendu au plafond ne happe pas le visiteur qui marche dessous.
    for (const mesh of this.current.portalMeshes) {
      // seul un portail DEBOUT se franchit à la marche : un portail couché
      // sur un mur (vu depuis le sol d'une pièce Escher) reste un décor
      // intrigant — on le prendra depuis son propre plan, ou au clic
      _worldUp.set(0, 1, 0).transformDirection(mesh.matrixWorld);
      if (_worldUp.y < 0.7) continue;
      const p = mesh.localToWorld(_worldPos.set(0, 1.35, 0));
      const dx = ctx.cameraPos.x - p.x;
      const dz = ctx.cameraPos.z - p.z;
      const dy = ctx.cameraPos.y - p.y;
      const d2 = dx * dx + dz * dz;
      // un portail désarmé (on a atterri dedans) se réarme en QUITTANT sa
      // zone — hystérésis : le rayon de réarmement dépasse celui d'entrée
      if (mesh.userData.disarmed) {
        if (d2 > REARM_DIST2) mesh.userData.disarmed = false;
        continue;
      }
      if (estFerme(mesh)) continue;   // délai de réarmement : la porte est rouge
      // pendant la dérive guidée, la caméra VOLE : les zones ne se
      // déclenchent pas sous elle — la dérive franchit ses portes elle-même
      if (this.app.derive?.active) continue;
      // et l'on ne franchit un portail qu'en MARCHANT : tourner la caméra
      // la promène autour de la cible, ce qui suffisait à la faire entrer
      if (this.app.controls && !this.app.controls.walking) continue;
      if (d2 < 2.6 && Math.abs(dy) < 1.25) {
        // ON NE FRANCHIT QUE CE QUE L'ON VOIT, ET EN Y ALLANT.
        // Deux portes dérobées restaient ouvertes : pivoter dos au portail
        // (la caméra orbite, elle entre dans la zone par le côté) et RECULER
        // dedans. Le seuil demande donc que le portail soit à l'écran — et
        // que le pas se fasse vers lui, pas en s'en éloignant.
        if (!this._estVisible(p)) continue;
        if (!this._vaVers(p, ctx)) continue;
        this.traverse(mesh.userData.portal);
        return;
      }
    }
    // zones de bascule (hauts d'escaliers) : mêmes règles de désarmement
    for (const mesh of this.current.basculeMeshes ?? []) {
      const cfg = mesh.userData.bascule;
      // Une SPHÈRE de transfert sert les deux sens : celui qui s'applique
      // est donné par le plan sur lequel on se tient, non par la face de
      // l'objet (une sphère n'en a pas). Depuis un plan qu'elle ne dessert
      // pas, elle n'est qu'un décor suspendu.
      let saut = cfg;
      if (Array.isArray(cfg.transferts)) {
        const t = cfg.transferts.find((x) => x.depuis === (this.current.plane ?? 'sol'));
        if (!t) continue;
        saut = { plane: t.vers, arrival: t.arrival, cooldown: cfg.cooldown,
          label: t.label ?? cfg.label };
      } else {
        // un anneau n'agit que depuis SON plan : face tournée vers le haut.
        // Celui du plafond, vu du sol, pend à l'envers — décor, pas piège.
        _worldUp.set(0, 0, 1).transformDirection(mesh.matrixWorld);
        if (_worldUp.y < 0.7) continue;
      }
      const r = cfg.radius ?? 1.7;
      const c = mesh.getWorldPosition(_worldPos);
      const dx = ctx.cameraPos.x - c.x;
      const dz = ctx.cameraPos.z - c.z;
      const dy = ctx.cameraPos.y - c.y;
      const d2 = dx * dx + dz * dz;
      if (mesh.userData.disarmed) {
        if (d2 > (r * 1.6) ** 2) mesh.userData.disarmed = false;
        continue;
      }
      if (estFerme(mesh)) continue;          // encore rouge : on patiente
      if (this.app.derive?.active) continue; // la dérive ne bascule pas
      if (this.app.controls && !this.app.controls.walking) continue; // ni le regard
      // Une sphère se traverse en VOLUME — mais c'est le CORPS qui la
      // traverse, pas l'œil : une sphère posée au sol est frôlée par des
      // pieds tandis que le regard passe deux mètres plus haut. On mesure
      // donc la distance au segment pieds-yeux, jamais au seul point de
      // vue. Un anneau, lui, se foule : à plat sous les pieds.
      const dyCorps = Math.max(0, Math.min(dy, dy - HAUTEUR_CORPS));
      const dedans = Array.isArray(cfg.transferts)
        ? d2 + dyCorps * dyCorps < r * r
        : d2 < r * r && dy > 0 && dy < 3.2;
      if (dedans) {
        // Mêmes gardes que les portails : ON NE BASCULE QUE CE QUE L'ON
        // VOIT, ET EN Y ALLANT — pivoter dos au passage ou reculer dedans
        // ne retourne pas le monde par surprise.
        if (!this._estVisible(c)) continue;
        if (!this._vaVers(c, ctx)) continue;
        this.basculer(this.current, saut, mesh);
        return;
      }
    }
    // légère pulsation des portails
    for (const mesh of this.current.portalMeshes) {
      const glow = mesh.userData.glow;
      if (glow && !this.app.quality.reducedMotion) {
        glow.material.opacity = 0.12 + 0.05 * Math.sin(ctx.time * 1.8);
      }
    }
  }

  /**
   * Franchit un passage. Rend false s'il a été refusé.
   *
   * **Une porte rouge ne se franchit pas, quelle que soit la manière.** Le
   * test du délai ne vivait que dans la boucle de proximité : marcher dans
   * une porte fermée était refusé, mais CLIQUER dessus passait outre — et
   * un délai qu'un clic contourne n'est pas un délai, c'est une décoration.
   * La garde vit donc ici, dans le passage lui-même, là où tous les chemins
   * se rejoignent.
   *
   * Sauter d'une salle à l'autre par le menu ou le catalogue reste permis :
   * ce n'est pas franchir une porte, c'est se téléporter — et rien n'y est
   * rouge.
   */
  traverse(portal) {
    const target = this.rooms.get(portal.cfg.to);
    if (!target) {
      console.warn(`[galerie] Portail vers une pièce inconnue : ${portal.cfg.to}`);
      return false;
    }
    if (estFerme(portal.mesh)) return false;
    // Le passage se ferme derrière soi, le temps de regarder où l'on est —
    // et la porte de RETOUR avec lui : une porte et sa jumelle sont le même
    // passage vu des deux côtés, elles ne peuvent pas être l'une ouverte et
    // l'autre fermée.
    const duree = delaiDe(portal.cfg, this.app);
    const depuis = portal.room?.config.id ?? this.current?.config.id;
    const jumelle = (target.portalMeshes ?? []).find(
      (m) => (m.userData.portal?.cfg ?? {}).to === depuis);

    // ON NE FERME JAMAIS LA SEULE ISSUE.
    //
    // Sept salles de cette galerie n'ont qu'une porte — l'annexe, et les six
    // faces du belvédère. Y refermer le passage derrière soi ne donnait pas
    // « le temps de regarder où l'on est » : ça donnait dix secondes de
    // cellule, devant une porte rouge, sans rien d'autre à tenter. Le délai
    // n'a de sens que lorsqu'il reste un ailleurs — sinon il n'empêche pas
    // le rebond, il empêche de sortir. Le désarmement (`disarmed`) suffit
    // d'ailleurs à éviter le rebond immédiat : on ne repart pas dans une
    // porte tant qu'on ne s'en est pas éloigné.
    const ailleurs = (target.config.portals ?? []).some(
      (p) => p.to && p.to !== depuis && p.to !== target.config.id);
    const aFermer = ailleurs ? [portal.mesh, jumelle] : [portal.mesh];
    for (const m of aFermer) {
      if (m && fermer(m, duree)) this._refroidis.add(m);
    }
    // Le répit de la porte de retour commence TOUT DE SUITE — la traversée
    // dure près d'une seconde, et sans cette marque la minimap l'aurait
    // déjà peinte en rouge avant même qu'on ait atterri. `Infinity` dit
    // « répit en cours, durée pas encore connue » ; l'arrivée le remplace
    // par un vrai instant, et le décompte commence alors.
    if (jumelle && ailleurs) jumelle.userData.arriveeA = Infinity;
    // Le trait sur la carte se gagne en FRANCHISSANT le passage : sauter
    // d'une pièce à l'autre par le menu montre les deux salles, jamais le
    // lien — c'est bien en marchant qu'on apprend comment tout se tient.
    this.app.memoire?.noterPorte(depuis, target.config.id);
    const arrival = portal.cfg.arrival ?? target.config.spawn ?? [0, 2.2, 10];
    // `plane` : sur quel plan de la pièce cible on débarque (Escher).
    // La cible peut être LA MÊME pièce — on en ressort sur un autre mur.
    this.setCurrent(target.config.id, { arrival, plane: portal.cfg.plane ?? 'sol' })
      .then(() => {
        // On date l'ARRIVÉE, pas le départ : compter depuis le début aurait
        // laissé le fondu manger la moitié du répit. Passé ce court instant,
        // la minimap le dit — une porte fermée doit se voir fermée.
        if (jumelle && ailleurs) jumelle.userData.arriveeA = performance.now();
      });
    return true;
  }

  /** L'ambiance démarre après le déblocage audio : à rappeler à ce moment. */
  onAudioUnlocked() {
    for (const room of this.rooms.values()) this._updateAmbience(room);
  }
}

/* --------------------------------------------------------------- sol --- */

/**
 * Sol de la pièce — un plan simple, mais qui change tout : sans lui, les
 * œuvres flottent dans un noir sans repère et l'on ne perçoit ni sa
 * hauteur ni son déplacement. Une grille discrète donne l'échelle sans
 * décorer.
 *
 * Réglable par pièce dans le JSON, et absent si on le refuse :
 *   "floor": false                       → aucun sol
 *   "floor": { "size": 60, "color": "#0d0d16", "grid": true }
 *
 * Défauts choisis sombres : la galerie reste une salle de nuit, le sol
 * doit se deviner, pas éclairer.
 */
export const FLOOR_DEFAULTS = { size: 80, color: '#13131f', grid: true, gridColor: '#39395c' };

export function buildFloor(config) {
  if (config?.floor === false) return null;
  const opt = { ...FLOOR_DEFAULTS, ...(config?.floor === true ? {} : config?.floor ?? {}) };
  const size = Number.isFinite(opt.size) && opt.size > 0 ? opt.size : FLOOR_DEFAULTS.size;

  const group = new THREE.Group();
  group.name = 'sol';
  // texture pixel-art optionnelle (« texture »: pierre, herbe, dalles…) —
  // en niveaux de gris, teintée par la couleur du sol : la palette de la
  // pièce reste maîtresse, la texture n'apporte que la matière
  const map = styleTexture(opt.texture);
  const geometry = new THREE.PlaneGeometry(size, size);
  // `textureRepeat` resserre ou étale le motif ; rugosité et métal donnent
  // la matière — un sol ciré n'est pas un sable, même sous la même texture
  const rep = Number(opt.textureRepeat) > 0 ? opt.textureRepeat : 1;
  if (map) scalePlaneUV(geometry, size * rep, size * rep);
  const plane = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(opt.color ?? FLOOR_DEFAULTS.color),
      map,
      roughness: Number.isFinite(opt.roughness) ? opt.roughness : 0.95,
      metalness: Number.isFinite(opt.metalness) ? opt.metalness : 0.05
    })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  // le sol ne doit pas intercepter le sélecteur d'œuvres ni les rayons de
  // l'éditeur : il n'est pas une cible, seulement un repère
  plane.userData.ignoreRaycast = true;
  group.add(plane);

  if (opt.grid) {
    const divisions = Math.max(4, Math.round(size / 2));
    const grid = new THREE.GridHelper(size, divisions,
      new THREE.Color(opt.gridColor ?? FLOOR_DEFAULTS.gridColor),
      new THREE.Color(opt.gridColor ?? FLOOR_DEFAULTS.gridColor));
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.material.depthWrite = false;
    grid.position.y = 0.01; // évite le z-fighting avec le plan
    group.add(grid);
  }
  return group;
}

function disposeFloor(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) m.dispose();
  });
}

/* ---------------------------------------------------------------- coque --- */

/**
 * Coque de la pièce — les murs qui font d'un sol une salle de musée.
 *
 * Réglable par pièce dans le JSON, absente si on n'en veut pas (extérieur) :
 *   "shell": { "width": 26, "depth": 20, "height": 5,
 *              "color": "#1c1c2b", "ceiling": false,
 *              "walls": ["nord", "est"],          // absent = les 4 murs
 *              "windows": [ { "wall": "nord", "offset": 0,
 *                             "width": 4, "height": 1.8, "sill": 1.1 } ] }
 *
 * Un espace n'est jamais forcé au confinement : de 0 à 4 murs (`walls`),
 * plafond en option — d'un pavillon ouvert sur trois côtés à la boîte
 * close d'une pièce à la Escher.
 *
 * `wallColors` teinte chaque face indépendamment (murs et plafond) :
 *   "wallColors": { "nord": "#2a3a68", "est": "#2e5a3a", "plafond": "#3a2a58" }
 * C'est la boussole des pièces Escher — quand le mur vert devient le sol,
 * on SAIT qu'on a changé de plan. Les fenêtres portent un cadre
 * (`frameColor`) légèrement saillant et lumineux : une baie se lit comme
 * une baie, pas comme un trou.
 *
 * Les fenêtres sont des baies percées dans un mur (nord = fond -z, sud =
 * face +z, est = +x, ouest = -x ; offset le long du mur depuis son centre).
 * Il n'y a pas de vitre : elles donnent sur l'espace — le ciel étoilé et
 * le brouillard de la nuit, seule chose qui existe hors de la pièce.
 *
 * Les murs REÇOIVENT les ombres mais n'en projettent pas : la lumière clé
 * traverse — comme un éclairage de studio, la salle reste lisible quelle
 * que soit l'orientation du « soleil ». Un plafond est possible mais absent
 * par défaut : la nuit étoilée et la poussière font partie du lieu.
 */
export const SHELL_DEFAULTS = {
  width: 26, depth: 20, height: 5, color: '#1c1c2b', ceiling: false,
  walls: null, windows: []
};
export const WALL_NAMES = ['nord', 'sud', 'est', 'ouest'];
const WALL_T = 0.35; // épaisseur des murs

/**
 * FORMES D'OUVERTURE — ce qu'on peut percer dans un mur.
 *
 * Un mur n'est plus un assemblage de pavés contournant ses baies, mais UNE
 * surface extrudée dont les baies sont des trous. Le découpage en segments
 * ne savait faire que des rectangles : il posait un pavé à gauche, un à
 * droite, une allège sous l'appui, un linteau au-dessus. Une arche ou un
 * oculus n'y entraient pas — et c'est de l'architecture ordinaire.
 *
 *   rect   : une baie droite (le comportement historique, et le défaut) ;
 *   arche  : droite jusqu'aux naissances, puis un demi-cercle ;
 *   cercle : un oculus, inscrit dans la largeur ou la hauteur — la plus
 *            petite des deux, pour qu'il tienne toujours dans le mur.
 */
export const FORMES_OUVERTURE = ['rect', 'arche', 'cercle'];

/** Géométrie d'une baie, bornée au mur. Null si elle n'a plus de surface. */
function baie(o, length, height) {
  const from = Math.max(-length / 2, (o.offset ?? 0) - (o.width ?? 4) / 2);
  const to = Math.min(length / 2, (o.offset ?? 0) + (o.width ?? 4) / 2);
  const sill = Math.max(0, Math.min(height - 0.2, o.sill ?? 1.1));
  const top = Math.min(height, (o.sill ?? 1.1) + (o.height ?? 1.8));
  if (to <= from || top <= sill) return null;
  return {
    forme: FORMES_OUVERTURE.includes(o.shape) ? o.shape : 'rect',
    c: (from + to) / 2, wl: to - from, sill, top
  };
}

/**
 * Contour d'une baie, éventuellement DILATÉ de `marge` — c'est ce qui donne
 * le cadre : le même contour, une fois pour le trou, une fois élargi pour
 * la pièce de bois qui l'entoure.
 *
 * Les trois formes se dilatent analytiquement ; on n'essaie pas d'offsetter
 * un chemin quelconque, ce qui n'a pas de solution simple et n'aurait servi
 * qu'à des formes que personne ne demande.
 */
function contourBaie(b, marge = 0, height = Infinity) {
  const p = new THREE.Path();
  const demi = b.wl / 2 + marge;
  const bas = Math.max(-0.5, b.sill - marge);
  const haut = Math.min(height + 0.5, b.top + marge);

  if (b.forme === 'cercle') {
    const r = Math.min(b.wl, b.top - b.sill) / 2 + marge;
    p.absarc(b.c, (b.sill + b.top) / 2, Math.max(0.02, r), 0, Math.PI * 2, false);
    return p;
  }
  if (b.forme === 'arche') {
    // le cintre occupe le haut : sa naissance est à `haut - demi`, et
    // l'arche dégénère en demi-cercle si la baie est plus large que haute
    const naissance = Math.max(bas, haut - demi);
    p.moveTo(b.c - demi, bas);
    p.lineTo(b.c - demi, naissance);
    p.absarc(b.c, naissance, demi, Math.PI, 0, true);
    p.lineTo(b.c + demi, bas);
    p.lineTo(b.c - demi, bas);
    return p;
  }
  p.moveTo(b.c - demi, bas);
  p.lineTo(b.c + demi, bas);
  p.lineTo(b.c + demi, haut);
  p.lineTo(b.c - demi, haut);
  p.lineTo(b.c - demi, bas);
  return p;
}

/**
 * Où se tient un mur, et quelle longueur il fait.
 *
 * Les murs nord/sud portent sur la largeur PLUS l'épaisseur (ils ferment
 * les angles), est/ouest sur la profondeur MOINS l'épaisseur (ils s'y
 * logent). Cette asymétrie est ce qui rend les coins nets ; l'éditeur doit
 * la connaître pour viser juste, et la recopier chez lui l'aurait fait
 * dériver au premier changement.
 */
export function planMur(shell, wall) {
  const opt = { ...SHELL_DEFAULTS, ...(shell && shell !== true ? shell : {}) };
  const w = Math.max(2, Number(opt.width) || SHELL_DEFAULTS.width);
  const d = Math.max(2, Number(opt.depth) || SHELL_DEFAULTS.depth);
  const height = Math.max(1, Number(opt.height) || SHELL_DEFAULTS.height);
  switch (wall) {
    case 'nord': return { length: w + WALL_T, x: 0, z: -d / 2, rotY: 0, height, axe: 'x' };
    case 'sud': return { length: w + WALL_T, x: 0, z: d / 2, rotY: 0, height, axe: 'x' };
    case 'ouest': return { length: d - WALL_T, x: -w / 2, z: 0, rotY: Math.PI / 2, height, axe: 'z' };
    case 'est': return { length: d - WALL_T, x: w / 2, z: 0, rotY: Math.PI / 2, height, axe: 'z' };
    default: return null;
  }
}

/**
 * Silhouette d'une ouverture, dans le repère du mur — de quoi en dessiner
 * l'aperçu pendant qu'on la trace, sans réécrire les trois formes ailleurs.
 * Null si l'ouverture, bornée au mur, n'a plus de surface.
 */
export function silhouetteOuverture(o, length, height) {
  const b = baie(o, length, height);
  if (!b) return null;
  const forme = new THREE.Shape();
  forme.curves.push(...contourBaie(b, 0, height).curves);
  return forme;
}

/**
 * Un mur PERCÉ : une plaque rectangulaire dont chaque baie est un trou,
 * extrudée sur l'épaisseur du mur et centrée sur son plan.
 *
 * `sink` enfonce le pied sous le sol : deux faces exactement coplanaires
 * grésillent, et le pied de mur clignotait sur toute sa longueur.
 */
function murPerce(length, height, ouvertures, sink) {
  const forme = new THREE.Shape();
  forme.moveTo(-length / 2, -sink);
  forme.lineTo(length / 2, -sink);
  forme.lineTo(length / 2, height);
  forme.lineTo(-length / 2, height);
  forme.lineTo(-length / 2, -sink);
  for (const b of ouvertures) forme.holes.push(contourBaie(b, 0, height));

  // 36 segments par courbe : à 15° un oculus se lit comme un polygone, et
  // c'est justement l'objet qu'on regarde de près.
  const geo = new THREE.ExtrudeGeometry(forme, {
    depth: WALL_T, bevelEnabled: false, curveSegments: 36
  });
  geo.translate(0, 0, -WALL_T / 2);   // le mur est centré sur son plan
  return geo;
}

/** Cadre d'une baie : son contour dilaté, évidé de la baie elle-même. */
function cadreBaie(b, marge, profondeur, height) {
  const forme = new THREE.Shape();
  forme.curves.push(...contourBaie(b, marge, height).curves);
  forme.holes.push(contourBaie(b, 0, height));
  const geo = new THREE.ExtrudeGeometry(forme, {
    depth: profondeur, bevelEnabled: false, curveSegments: 36
  });
  geo.translate(0, 0, -profondeur / 2);
  return geo;
}

export function buildShell(config) {
  const s = config?.shell;
  if (!s || s === false) return null;
  const opt = { ...SHELL_DEFAULTS, ...(s === true ? {} : s) };
  const w = Math.max(2, Number(opt.width) || SHELL_DEFAULTS.width);
  const d = Math.max(2, Number(opt.depth) || SHELL_DEFAULTS.depth);
  const h = Math.max(1, Number(opt.height) || SHELL_DEFAULTS.height);

  const group = new THREE.Group();
  group.name = 'coque';
  const materials = new Map(); // une couleur = un matériau, partagé
  // texture pixel-art des murs (« texture »: pierre, brique…) — les UV de
  // chaque segment sont à l'échelle du monde (scaleBoxUV), si bien qu'un
  // seul matériau par couleur habille tous les segments sans étirement
  const wallMap = styleTexture(opt.texture);
  const matFor = (face) => {
    const color = opt.wallColors?.[face] ?? opt.color ?? SHELL_DEFAULTS.color;
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), map: wallMap,
        roughness: Number.isFinite(opt.roughness) ? opt.roughness : 0.88,
        metalness: Number.isFinite(opt.metalness) ? opt.metalness : 0.04
      }));
    }
    return materials.get(color);
  };
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opt.frameColor ?? '#4a4668'),
    roughness: 0.55, metalness: 0.25,
    emissive: new THREE.Color(opt.frameColor ?? '#4a4668'),
    emissiveIntensity: 0.3
  });
  // matériau des vitres invisibles : partagé, jamais rendu
  const invisibleMat = new THREE.MeshBasicMaterial({ visible: false });

  // `textureRepeat` de la coque : resserre le motif des murs partout
  const repMur = Number(opt.textureRepeat) > 0 ? opt.textureRepeat : 1;
  const box = (gw, gh, gd, x, y, z, mat) => {
    const g = new THREE.BoxGeometry(gw, gh, gd);
    if (mat.map) scaleBoxUV(g, gw * repMur, gh * repMur, gd * repMur);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.userData.ignoreRaycast = true; // décor : jamais une cible de sélection
    group.add(m);
  };

  /**
   * Vitre INVISIBLE d'une baie.
   *
   * Une fenêtre est un trou dans le mur : rien n'empêchait d'y entrer et de
   * se retrouver dehors, dans un espace que personne n'a meublé. Ce panneau
   * ne se voit pas (`visible = false`, donc jamais rendu, ni dans les
   * apparitions) mais les rayons de collision le rencontrent — three ne
   * consulte pas la visibilité au lancer de rayon. Une vitre, exactement :
   * on voit à travers, on ne passe pas au travers.
   *
   * Elle couvre TOUTE la hauteur du mur, et déborde en largeur : bornée à
   * la baie, un rayon rasant l'appui ou le linteau passait juste à côté
   * d'elle — et le visiteur se retrouvait coincé derrière la fenêtre. Rien
   * ne coûte à l'élargir : elle n'est jamais rendue.
   */
  const verre = (gw, gh, x, y, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), invisibleMat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.visible = false;
    m.userData.ignoreRaycast = true;
    m.userData.verre = true;
    group.add(m);
  };

  // Un mur dont la face inférieure repose EXACTEMENT sur le sol grésille :
  // les deux faces sont au même y, le GPU tranche au hasard et le pied de
  // mur clignote sur toute sa longueur. On l'enfonce de huit centimètres
  // sous le sol — personne ne les voit, et le pied redevient net.
  const SINK = 0.08;

  const has = (wall) => !Array.isArray(opt.walls) || opt.walls.includes(wall);
  const winsOf = (wall) => (opt.windows ?? []).filter((f) => f.wall === wall);
  const FT = 0.12;              // débord du cadre autour de la baie
  const FD = WALL_T + 0.14;     // il dépasse du mur : on le voit de biais

  /**
   * Pose un mur percé et les cadres de ses baies. `rotY` oriente la plaque :
   * les murs nord/sud regardent le long de x, est/ouest le long de z, et
   * c'est la seule différence entre eux.
   */
  const mur = (wall, length, x, z, rotY) => {
    const ouvertures = winsOf(wall)
      .map((o) => baie(o, length, h)).filter(Boolean);
    const geo = murPerce(length, h, ouvertures, SINK);
    if (wallMap) scaleWorldUV(geo, TILE / repMur);
    const m = new THREE.Mesh(geo, matFor(wall));
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    m.userData.ignoreRaycast = true;
    m.userData.mur = wall;      // l'éditeur vise un mur : il doit le nommer
    group.add(m);

    for (const b of ouvertures) {
      const cadre = new THREE.Mesh(cadreBaie(b, FT, FD, h), frameMat);
      cadre.position.set(x, 0, z);
      cadre.rotation.y = rotY;
      cadre.userData.ignoreRaycast = true;
      group.add(cadre);
      // vitre invisible : elle couvre TOUTE la hauteur du mur et déborde en
      // largeur — bornée à la baie, un rayon rasant l'appui passait à côté
      // et le visiteur se retrouvait coincé derrière la fenêtre
      const dx = rotY === 0 ? b.c : 0;
      const dz = rotY === 0 ? 0 : b.c;
      verre(b.wl + 2 * FT, h, x + dx, h / 2, z + dz, rotY);
    }
  };

  if (has('nord')) mur('nord', w + WALL_T, 0, -d / 2, 0);
  if (has('sud')) mur('sud', w + WALL_T, 0, d / 2, 0);
  if (has('ouest')) mur('ouest', d - WALL_T, -w / 2, 0, Math.PI / 2);
  if (has('est')) mur('est', d - WALL_T, w / 2, 0, Math.PI / 2);

  if (opt.ceiling) {
    box(w + WALL_T, WALL_T, d + WALL_T, 0, h + WALL_T / 2, 0, matFor('plafond'));
  }
  return group;
}

function disposeShell(group) {
  const mats = new Set();
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) mats.add(o.material);
  });
  for (const m of mats) m.dispose();
}

/* ------------------------------------------------------ modèles de pièce --- */

/**
 * Modèles de pièce — les briques de base d'un musée virtuel. Un modèle est
 * un préréglage complet (sol, coque, brouillard, lumière) appliqué à la
 * création d'une pièce ; tout reste modifiable ensuite, champ par champ.
 *
 *  - salle     : salle d'exposition murée, presque carrée ;
 *  - couloir   : passage étroit et long, pour relier deux ailes ;
 *  - exterieur : parvis ouvert sous le ciel — grand sol, pas de murs,
 *                clair de lune rasant. C'est le modèle du hall d'entrée.
 */
export const ROOM_TEMPLATES = {
  salle: {
    label: 'Salle',
    config: {
      floor: { size: 30, color: '#15151f', grid: false },
      shell: { width: 26, depth: 20, height: 6.5, color: '#1e1e2e' },
      fogColor: '#06060c',
      keyLight: { color: '#c4b8ff', intensity: 2.2, azimuth: 40, elevation: 60 },
      envIntensity: 1,
      spawn: [0, 2.2, 7]
    }
  },
  couloir: {
    label: 'Couloir',
    config: {
      floor: { size: 38, color: '#12121c', grid: false },
      shell: { width: 6, depth: 34, height: 5, color: '#1a1a28' },
      fogColor: '#05050b',
      keyLight: { color: '#b8c2ff', intensity: 1.8, azimuth: 0, elevation: 70 },
      envIntensity: 0.85,
      spawn: [0, 2.2, 14]
    }
  },
  exterieur: {
    label: 'Extérieur',
    config: {
      floor: { size: 140, color: '#191d2e', grid: true, gridColor: '#3c4266' },
      fogColor: '#090b16',
      keyLight: { color: '#c8d4ff', intensity: 3.2, azimuth: 205, elevation: 40 },
      envIntensity: 1.9,
      spawn: [0, 2.2, 8]
    }
  }
};

/* ----------------------------------------------------------- lumière clé --- */

/**
 * Lumière clé de la pièce — le « soleil » de la scène, comme la lampe
 * principale d'un rendu EEVEE. Une seule directionnelle par pièce, la seule
 * source à projeter des ombres : les œuvres se posent au sol au lieu de
 * flotter, et le coût reste celui d'UNE carte d'ombre.
 *
 * Réglable par pièce dans le JSON, et absente si on la refuse :
 *   "keyLight": false
 *   "keyLight": { "color": "#b8c2ff", "intensity": 2, "azimuth": 35, "elevation": 55 }
 *
 * azimuth (°, 0 = +Z, sens horaire vu de dessus) et elevation (° au-dessus
 * de l'horizon) décrivent la direction, comme le soleil de Blender.
 */
export const KEYLIGHT_DEFAULTS = { color: '#b8c2ff', intensity: 2, azimuth: 35, elevation: 55 };

export function buildKeyLight(config, profile) {
  if (config?.keyLight === false) return null;
  const opt = { ...KEYLIGHT_DEFAULTS, ...(config?.keyLight ?? {}) };

  const light = new THREE.DirectionalLight(new THREE.Color(opt.color), opt.intensity);
  light.name = 'lumiere-cle';

  if (profile?.shadows && opt.shadows !== false) {
    light.castShadow = true;
    light.shadow.mapSize.setScalar(profile.shadowMapSize ?? 1024);
    // le biais normal évite l'acné d'ombre sans décoller les contacts
    light.shadow.normalBias = 0.05;
    light.shadow.bias = -0.0002;
  }

  const group = new THREE.Group();
  group.name = 'lumiere-cle-groupe';
  group.add(light, light.target);
  group.userData.light = light;
  group.userData.ombres = light.castShadow;
  orientKeyLight(group, config);
  frameKeyLightShadow(group, config);
  return group;
}

/** Cadre la caméra d'ombre sur le sol de la pièce (recadrable à chaud). */
export function frameKeyLightShadow(group, config) {
  const light = group.userData.light;
  if (!light.castShadow) return;
  const size = Number(config?.floor?.size) > 0 ? config.floor.size : FLOOR_DEFAULTS.size;
  const half = size / 2 + 2;
  const cam = light.shadow.camera;
  cam.left = -half; cam.right = half;
  cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = size * 2 + 30;
  cam.updateProjectionMatrix();
}

/** (Ré)oriente et re-règle la lumière clé depuis la config, sans recréer. */
export function orientKeyLight(group, config) {
  const opt = { ...KEYLIGHT_DEFAULTS, ...(config?.keyLight ?? {}) };
  const light = group.userData.light;
  light.color.set(opt.color);
  light.intensity = opt.intensity;
  const az = THREE.MathUtils.degToRad(opt.azimuth);
  const el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(opt.elevation, 5, 89));
  const size = Number(config?.floor?.size) > 0 ? config.floor.size : FLOOR_DEFAULTS.size;
  const dist = size * 0.75 + 10;
  light.position.set(
    Math.sin(az) * Math.cos(el) * dist,
    Math.sin(el) * dist,
    Math.cos(az) * Math.cos(el) * dist
  );
  light.target.position.set(0, 0, 0);
}

function disposeKeyLight(group) {
  const light = group.userData.light;
  light.shadow?.map?.dispose();
  light.dispose();
}

/* ---------------------------------------------------- lumière ambiante --- */

/**
 * Lumière AMBIANTE de pièce — un lavis uniforme, optionnel :
 *   "ambient": { "color": "#404050", "intensity": 0.6 }
 * L'environnement (IBL, `envIntensity`) éclaire déjà par l'image, mais il
 * teinte selon les normales ; l'ambiante, elle, relève tout d'un même ton —
 * c'est l'outil des pièces trop sombres qu'on ne veut pas récrire lampe à
 * lampe. Absente (ou intensité 0), aucune lumière n'est créée.
 */
export function buildAmbient(config) {
  const a = config?.ambient;
  if (!a || !(Number(a.intensity) > 0)) return null;
  const light = new THREE.AmbientLight(
    new THREE.Color(a.color ?? '#ffffff'), a.intensity);
  light.name = 'lumiere-ambiante';
  return light;
}

/* ------------------------------------------------------ zones de bascule --- */

/**
 * Anneau lumineux au sol : la marque d'une bascule de plan. Configurable
 * par pièce :
 *   "bascules": [ { "position": [x, y, z], "rotation": [0, 0, 0],
 *                   "radius": 1.7, "plane": "est", "arrival": [x, y, z] } ]
 * `rotation` couche l'anneau sur le plan auquel il appartient (un anneau
 * du mur est s'auteure [0, 0, 90], comme les portails Escher).
 */
/**
 * Le SABLIER DE LA GRAVITÉ : deux cônes pointe à pointe et un grain entre
 * eux — le signe que le sens du monde s'inverse ici. Posé à plat dans un
 * anneau (l'axe z du groupe est sa verticale), flottant au centre d'une
 * sphère de transfert.
 */
function sablier(mat) {
  const cone = new THREE.ConeGeometry(0.22, 0.42, 14);
  const haut = new THREE.Mesh(cone, mat);
  haut.rotation.x = Math.PI / 2;        // pointe vers le grain (bas)
  haut.position.set(0, 0, 0.62);
  const grain = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), mat);
  const bas = new THREE.Mesh(cone, mat);
  bas.rotation.x = -Math.PI / 2;        // pointe vers le grain (haut)
  bas.position.set(0, 0, -0.62);
  const pieces = [haut, grain, bas];
  for (const o of pieces) o.raycast = () => {};
  return pieces;
}

export function buildBascules(config) {
  return (config?.bascules ?? []).map((cfg) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c0c14, roughness: 0.35, metalness: 0.5,
      emissive: PORTAL_COLOR, emissiveIntensity: 0.9
    });

    // SPHÈRE DE TRANSFERT (`transferts`) : un seul objet pour les deux sens.
    // Deux anneaux — un pour partir, un pour revenir — disaient la même
    // chose en double et obligeaient à les poser à deux endroits. Une
    // sphère se traverse dans les deux sens : le sens est donné par le plan
    // sur lequel on se tient, pas par la face de l'objet. Le sablier de la
    // gravité flotte en son centre, la coque de verre marque le volume.
    if (Array.isArray(cfg.transferts)) {
      const groupe = new THREE.Group();
      const r = cfg.radius ?? 2.2;
      const coque = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.92, 26, 18),
        new THREE.MeshStandardMaterial({
          color: 0x0c0c14, roughness: 0.2, metalness: 0.4,
          emissive: PORTAL_COLOR, emissiveIntensity: 0.55,
          transparent: true, opacity: 0.16, depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      coque.raycast = () => {};
      groupe.add(coque, ...sablier(mat));
      groupe.position.set(cfg.position[0], cfg.position[1] ?? 0, cfg.position[2]);
      groupe.userData.bascule = cfg;
      groupe.userData.ignoreRaycast = true;
      groupe.name = 'sphere-transfert';
      return groupe;
    }
    // L'anneau est DISCRET (le rayon de déclenchement, lui, ne change pas) :
    // un cerceau serré autour du SIGNE de l'inversion — deux cônes pointe à
    // pointe et un grain entre eux, le sablier de la gravité. C'est le signe
    // qui annonce « ici, le sens du monde se retourne », pas la taille du
    // cerceau.
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.055, 10, 40), mat);
    for (const o of sablier(mat)) mesh.add(o);
    const [rx, ry, rz] = cfg.rotation ?? [0, 0, 0];
    mesh.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz)
    );
    mesh.rotateX(-Math.PI / 2); // à plat sur son plan
    mesh.position.set(cfg.position[0], (cfg.position[1] ?? 0), cfg.position[2]);
    mesh.translateZ(0.08); // léger décollement : pas de z-fighting avec le sol
    mesh.userData.bascule = cfg;
    mesh.userData.ignoreRaycast = true;
    mesh.name = 'bascule';
    return mesh;
  });
}

/* ------------------------------------------------------- mesh de portail --- */

function buildPortalMesh(cfg, label) {
  const group = new THREE.Group();
  group.position.set(cfg.position[0], cfg.position[1] ?? 0, cfg.position[2]);
  const r = cfg.rotation ?? [0, cfg.rotationY ?? 0, 0];
  group.rotation.set(
    THREE.MathUtils.degToRad(r[0] ?? 0),
    THREE.MathUtils.degToRad(r[1] ?? 0),
    THREE.MathUtils.degToRad(r[2] ?? 0)
  );

  const mat = new THREE.MeshStandardMaterial({
    color: 0x0c0c14, roughness: 0.4, metalness: 0.6,
    emissive: PORTAL_COLOR, emissiveIntensity: 0.8
  });
  const post = new THREE.BoxGeometry(0.14, 2.7, 0.14);
  const left = new THREE.Mesh(post, mat);
  left.position.set(-0.85, 1.35, 0);
  const right = new THREE.Mesh(post, mat);
  right.position.set(0.85, 1.35, 0);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.14, 0.14), mat);
  lintel.position.set(0, 2.77, 0);
  group.add(left, right, lintel);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.56, 2.6),
    new THREE.MeshBasicMaterial({
      color: PORTAL_COLOR, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  glow.position.set(0, 1.35, 0);
  group.add(glow);
  group.userData.glow = glow;

  // étiquette (CanvasTexture) : le nom de la salle, et sous lui le compte
  // de ses œuvres — voir `peindreEtiquette`
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 176;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false
  }));
  sprite.scale.set(2.6, 0.9, 1);
  sprite.position.set(0, 3.4, 0);
  group.add(sprite);
  group.userData.etiquette = { canvas, tex, nom: cfg.label ?? label ?? '', bilan: null };
  peindreEtiquette(group, null);

  return group;
}

/**
 * L'étiquette d'un portail : le nom de la salle, et sous lui ce qu'elle
 * contient — « ◆ 1 / 4 ».
 *
 * Un nom seul ne dit pas s'il vaut le détour. Le compte, lui, promet sans
 * rien dévoiler : on apprend qu'il y a quatre œuvres derrière cette porte
 * et qu'on en connaît une, jamais lesquelles. C'est ce qui fait qu'on
 * pousse la porte — et ce qui rend supportable un compteur d'écran devenu
 * local à la salle où l'on se tient.
 *
 * `bilan` à null : on ne sait pas encore (la progression n'existe pas au
 * moment où la porte se construit) — on n'écrit alors que le nom.
 */
function peindreEtiquette(group, bilan) {
  const e = group.userData.etiquette;
  if (!e) return;
  const cle = bilan ? `${bilan.vues}/${bilan.total}` : '';
  if (e.bilan === cle) return;            // rien de neuf : pas de ré-upload
  e.bilan = cle;
  const g = e.canvas.getContext('2d');
  g.clearRect(0, 0, e.canvas.width, e.canvas.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '300 52px system-ui, sans-serif';
  g.fillStyle = '#cfc8ff';
  g.fillText(e.nom, 256, 52);
  if (bilan && bilan.total > 0) {
    g.font = '300 38px system-ui, sans-serif';
    // tout trouvé : la porte le dit d'une couleur, sans un mot de plus
    g.fillStyle = bilan.vues >= bilan.total ? '#8fe0c0' : 'rgba(207, 200, 255, 0.62)';
    g.fillText(`\u25C6 ${bilan.vues} / ${bilan.total}`, 256, 122);
  }
  e.tex.needsUpdate = true;
}

function disposePortalMesh(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
