import * as THREE from 'three';
import { assetUrl } from './utils.js';

const PORTAL_COLOR = 0x9f8cff;
const _worldPos = new THREE.Vector3(); // tampons du test de proximité
const _worldUp = new THREE.Vector3();

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
    const wanted = cfg.keyLight !== false;
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
    if (room.isCurrent) this.applyEnvIntensity(room);
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
    this.app.vistas?.dispose(room);
    this.app.vistas?.build(room);
    if (room.keyLight) {
      orientKeyLight(room.keyLight, room.config);
      frameKeyLightShadow(room.keyLight, room.config);
    }
    if (room.isCurrent) {
      this.applyEnvIntensity(room);
      const fog = room.config.fogColor;
      if (fog) {
        this.app.scene.fog.color.set(fog);
        this.app.scene.background.set(fog);
      }
    }
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
      this.app.vistas?.dispose(room);
      room.group.removeFromParent();
    }
    this.rooms.clear();
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

  _placeCamera(pos) {
    const cam = this.app.camera;
    cam.position.set(pos[0], pos[1], pos[2]);
    // regarde vers le centre de la pièce
    const dir = new THREE.Vector3(-pos[0], 0, -pos[2]);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
    this.app.controls?.orbit.target
      .set(pos[0], pos[1] - 0.2, pos[2])
      .addScaledVector(dir, 4);
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
    const fog = this.current?.config.fogColor;
    if (fog) {
      this.app.scene.fog.color.set(fog);
      this.app.scene.background.set(fog);
    }
    this.applyEnvIntensity();
  }

  /* ---------------------------------------------------------- ambiance --- */

  async _updateAmbience(room) {
    const cfgs = room.config.ambience ?? [];
    if (!cfgs.length || !this.app.audio.unlocked) return;
    if (room.state === 'far') return;

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
        bus.connect(engine.master);
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
    room.ambience.bus?.disconnect();
    for (const c of room.config.ambience ?? []) {
      this.app.audio.release(this.app.resolveAsset(c.file));
    }
    room.ambience = null;
  }

  /* ------------------------------------------------------------- cycle --- */

  update(dt, ctx) {
    if (this._cooldown > 0) this._cooldown -= dt;
    if (!this.current || this._transitioning || this._cooldown > 0) return;
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
      if (dx * dx + dz * dz < 2.6 && Math.abs(dy) < 1.25) {
        this.traverse(mesh.userData.portal);
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

  traverse(portal) {
    const target = this.rooms.get(portal.cfg.to);
    if (!target) {
      console.warn(`[galerie] Portail vers une pièce inconnue : ${portal.cfg.to}`);
      return;
    }
    const arrival = portal.cfg.arrival ?? target.config.spawn ?? [0, 2.2, 10];
    // `plane` : sur quel plan de la pièce cible on débarque (Escher).
    // La cible peut être LA MÊME pièce — on en ressort sur un autre mur.
    this.setCurrent(target.config.id, { arrival, plane: portal.cfg.plane ?? 'sol' });
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
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(opt.color ?? FLOOR_DEFAULTS.color),
      roughness: 0.95,
      metalness: 0.05
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
 * Découpe un mur (longueur × hauteur) autour de ses baies : segments pleins
 * entre les fenêtres, allège sous l'appui et linteau au-dessus. Renvoie des
 * rectangles {c, len, y, h} en coordonnées locales du mur (c = centre le
 * long du mur, y = centre en hauteur).
 */
function wallSegments(length, height, windows) {
  const wins = (windows ?? [])
    .map((w) => ({
      from: Math.max(-length / 2, (w.offset ?? 0) - (w.width ?? 4) / 2),
      to: Math.min(length / 2, (w.offset ?? 0) + (w.width ?? 4) / 2),
      sill: Math.max(0, Math.min(height - 0.2, w.sill ?? 1.1)),
      top: Math.min(height, (w.sill ?? 1.1) + (w.height ?? 1.8))
    }))
    .filter((w) => w.to > w.from)
    .sort((a, b) => a.from - b.from);

  const parts = [];
  let cursor = -length / 2;
  for (const win of wins) {
    if (win.from > cursor) {
      parts.push({ c: (cursor + win.from) / 2, len: win.from - cursor, y: height / 2, h: height });
    }
    const wl = win.to - win.from, wc = (win.from + win.to) / 2;
    if (win.sill > 0) parts.push({ c: wc, len: wl, y: win.sill / 2, h: win.sill });
    if (win.top < height) {
      parts.push({ c: wc, len: wl, y: (win.top + height) / 2, h: height - win.top });
    }
    cursor = win.to;
  }
  if (cursor < length / 2) {
    parts.push({ c: (cursor + length / 2) / 2, len: length / 2 - cursor, y: height / 2, h: height });
  }
  return parts;
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
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opt.color ?? SHELL_DEFAULTS.color),
    roughness: 0.88, metalness: 0.04
  });

  const box = (gw, gh, gd, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.userData.ignoreRaycast = true; // décor : jamais une cible de sélection
    group.add(m);
  };

  const has = (wall) => !Array.isArray(opt.walls) || opt.walls.includes(wall);
  const winsOf = (wall) => (opt.windows ?? []).filter((f) => f.wall === wall);
  // fond (-z) et face (+z) : segments le long de x
  if (has('nord')) for (const p of wallSegments(w + WALL_T, h, winsOf('nord'))) {
    box(p.len, p.h, WALL_T, p.c, p.y, -d / 2);
  }
  if (has('sud')) for (const p of wallSegments(w + WALL_T, h, winsOf('sud'))) {
    box(p.len, p.h, WALL_T, p.c, p.y, d / 2);
  }
  // gauche (-x) et droite (+x) : segments le long de z
  if (has('ouest')) for (const p of wallSegments(d - WALL_T, h, winsOf('ouest'))) {
    box(WALL_T, p.h, p.len, -w / 2, p.y, p.c);
  }
  if (has('est')) for (const p of wallSegments(d - WALL_T, h, winsOf('est'))) {
    box(WALL_T, p.h, p.len, w / 2, p.y, p.c);
  }

  if (opt.ceiling) {
    box(w + WALL_T, WALL_T, d + WALL_T, 0, h + WALL_T / 2, 0);
  }
  return group;
}

function disposeShell(group) {
  group.traverse((o) => { o.geometry?.dispose(); });
  // matériau partagé par tous les murs : une seule libération suffit
  group.children[0]?.material?.dispose();
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

  if (profile?.shadows) {
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

  // étiquette (CanvasTexture)
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const g = canvas.getContext('2d');
  g.font = '300 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#cfc8ff';
  g.fillText(cfg.label ?? label ?? '', 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false
  }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.position.set(0, 3.3, 0);
  group.add(sprite);

  return group;
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
