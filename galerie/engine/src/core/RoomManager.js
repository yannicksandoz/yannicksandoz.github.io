import * as THREE from 'three';
import { assetUrl } from './utils.js';

const PORTAL_COLOR = 0x9f8cff;

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
    room.group.visible = false;
    this.app.scene.add(room.group);
    this.rooms.set(config.id, room);
    return room;
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

  /** Change de pièce. instant = true pour l'éditeur (pas de fondu). */
  async setCurrent(id, { instant = false, arrival = null } = {}) {
    const room = this.rooms.get(id);
    if (!room || this._transitioning) return;

    if (!instant) {
      this._transitioning = true;
      this.fadeEl?.classList.add('active');
      await wait(380);
    }

    this.current = room;
    this._applyPolicy();
    this._placeCamera(arrival ?? room.config.spawn ?? [0, 2.2, 10]);

    if (!instant) {
      await wait(120);
      this.fadeEl?.classList.remove('active');
      this._transitioning = false;
      this._cooldown = 1.2; // évite un aller-retour immédiat dans le portail
    }
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
    const adjacent = new Set(
      (this.current?.config.portals ?? []).map((p) => p.to)
    );
    for (const room of this.rooms.values()) {
      const prev = room.state;
      room.state = room.isCurrent ? 'current'
        : adjacent.has(room.config.id) ? 'adjacent'
        : 'far';
      room.group.visible = room.isCurrent;

      if (room.state === 'far' && prev !== 'far') {
        for (const a of room.artworks) a.forceUnload();
        this._releaseAmbience(room);
      }
      for (const a of room.artworks) a.setVideoPlaying(room.isCurrent);
      this._updateAmbience(room);
    }
    // ambiance de la pièce (brouillard configurable par pièce)
    const fog = this.current?.config.fogColor;
    if (fog) {
      this.app.scene.fog.color.set(fog);
      this.app.scene.background.set(fog);
    }
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

    // franchissement par proximité
    for (const mesh of this.current.portalMeshes) {
      const p = mesh.userData.portal.cfg;
      const dx = ctx.cameraPos.x - p.position[0];
      const dz = ctx.cameraPos.z - p.position[2];
      if (dx * dx + dz * dz < 2.6) {
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
    this.setCurrent(target.config.id, { arrival });
  }

  /** L'ambiance démarre après le déblocage audio : à rappeler à ce moment. */
  onAudioUnlocked() {
    for (const room of this.rooms.values()) this._updateAmbience(room);
  }
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
