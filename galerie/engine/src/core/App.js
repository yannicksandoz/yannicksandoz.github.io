import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioEngine } from './AudioEngine.js';
import { QualityManager } from './Quality.js';
import { LoadingTracker, assetUrl } from './utils.js';

const FOG_COLOR = 0x05050a;

/** Grain animé + vignettage, appliqué après le tone mapping. */
const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 0.4 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float g = (rand(vUv + fract(uTime * 61.7)) - 0.5) * uGrain;
      col.rgb += g;
      float d = distance(vUv, vec2(0.5));
      col.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * uVignette;
      gl_FragColor = col;
    }`
};

/**
 * Cœur minimal : scène, caméra, rendu, post-processing, boucle d'animation.
 * Tout le reste (œuvres, contrôles, éditeur) s'enregistre via addArtwork()
 * et onUpdate(). Le profil de qualité (QualityManager) adapte le pipeline
 * à l'appareil et au framerate mesuré.
 */
export class App {
  constructor(container) {
    this.container = container;
    this.audio = new AudioEngine();
    this.quality = new QualityManager();
    this.loading = new LoadingTracker();
    this.artworks = [];
    // Fichiers importés dans l'éditeur : chemin de config → URL blob
    this.assetOverrides = new Map();
    this._updatables = [];
    this._clickHandlers = [];
    this._stemBudgetAcc = 0;
    this.clock = new THREE.Clock();

    const profile = this.quality.profile;

    // --- scène ---------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.026);

    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 220
    );
    this.camera.position.set(0, 2.2, 14);

    // --- rendu ---------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      antialias: profile.antialias,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);
    this.quality.refineWithRenderer(this.renderer);

    // --- post-processing : bloom + grain -------------------------------
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.quality.profile.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(
        Math.max(1, Math.round(window.innerWidth * this.quality.profile.bloomResScale)),
        Math.max(1, Math.round(window.innerHeight * this.quality.profile.bloomResScale))
      ),
      this.quality.profile.bloomStrength,
      0.7,   // rayon
      0.55   // seuil : seules les zones émissives fleurissent
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainVignetteShader);
    this.grainPass.enabled = this.quality.profile.grain;
    this.composer.addPass(this.grainPass);

    this._buildEnvironment();
    this._setupPicking();
    this._setupVisibility();

    window.addEventListener('resize', () => this._resize());
  }

  /* ------------------------------------------------------------------ */

  _buildEnvironment() {
    this.scene.add(new THREE.HemisphereLight(0x2a2a44, 0x050508, 0.7));

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 64),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.95, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(180, 90, 0x1a1a26, 0x12121c);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);

    // Poussière en suspension (densité selon le profil)
    const count = this.quality.profile.dustCount;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 8 + Math.random() * 55;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.3 + Math.random() * 11;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x8890c8, size: 0.055, transparent: true, opacity: 0.4,
      depthWrite: false, sizeAttenuation: true
    }));
    this.scene.add(this.dust);
  }

  _setupPicking() {
    // Distinction clic / drag d'orbite : on mesure le déplacement du pointeur.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0, downY = 0;

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX; downY = e.clientY;
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      ndc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      raycaster.setFromCamera(ndc, this.camera);

      // cibles : œuvres de la pièce courante + portails de la pièce courante
      const meshes = this.artworks
        .filter((a) => !a.room || a.room.state === 'current')
        .map((a) => a.hitMesh)
        .filter(Boolean);
      if (this.rooms?.current) meshes.push(...this.rooms.current.portalMeshes);

      const intersections = raycaster.intersectObjects(meshes, true);
      let hit = null;
      if (intersections.length) {
        let obj = intersections[0].object;
        while (obj && !obj.userData.artwork && !obj.userData.portal) obj = obj.parent;
        if (obj?.userData.artwork) hit = { type: 'artwork', artwork: obj.userData.artwork };
        else if (obj?.userData.portal) hit = { type: 'portal', portal: obj.userData.portal };
      }
      for (const h of this._clickHandlers) {
        if (h(hit, e)) return; // un handler peut consommer le clic
      }
    });
  }

  /** Chemin de config → URL réelle (les imports de l'éditeur sont des blobs). */
  resolveAsset(path) {
    return this.assetOverrides.get(path) ?? assetUrl(path);
  }

  /** Onglet masqué → boucle en pause + audio suspendu (économie de batterie). */
  _setupVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.renderer.setAnimationLoop(null);
        this.audio.suspend();
      } else {
        this.clock.getDelta(); // purge le delta accumulé pendant la pause
        if (this._started) this._runLoop();
        this.audio.resume();
      }
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /* ------------------------------------------------------------------ */

  /** Module FocusCamera actuellement en avant-plan (ou null). */
  setActiveFocus(module) {
    this.activeFocus = module;
  }

  /** Ajoute une œuvre, dans une pièce si le système de rooms est actif. */
  addArtwork(artwork, room = null) {
    this.artworks.push(artwork);
    if (room) {
      artwork.room = room;
      room.artworks.push(artwork);
      room.group.add(artwork.group);
    } else {
      this.scene.add(artwork.group);
    }
  }

  removeArtwork(artwork) {
    const i = this.artworks.indexOf(artwork);
    if (i >= 0) this.artworks.splice(i, 1);
    if (artwork.room) {
      const j = artwork.room.artworks.indexOf(artwork);
      if (j >= 0) artwork.room.artworks.splice(j, 1);
    }
    artwork.dispose();
  }

  /** Enregistre un callback appelé à chaque frame : fn(dt, ctx). */
  onUpdate(fn) {
    this._updatables.push(fn);
  }

  /** Prévient les abonnés qu'une œuvre vient de charger son visuel. */
  onVisualLoaded(fn) {
    (this._visualListeners ??= []).push(fn);
  }

  notifyVisualLoaded(artwork) {
    for (const fn of this._visualListeners ?? []) fn(artwork);
  }

  /** Enregistre un handler de clic : fn(artworkOuNull, event) → bool (consommé). */
  onArtworkClick(fn) {
    this._clickHandlers.push(fn);
  }

  /**
   * Budget global de stems simultanés (« voice stealing » par distance) :
   * les œuvres les plus proches gardent leurs pistes, les plus lointaines
   * sont suspendues quand le plafond du profil est atteint.
   */
  _updateStemBudget() {
    const budget = this.quality.profile.maxStems;
    const candidates = this.artworks
      .filter((a) => a.audioReady && a.stems.length
        && (!a.room || a.room.state === 'current'))
      .map((a) => ({ a, d: a.distance }))
      .filter((x) => x.d < x.a.maxAudibleRadius + 6)
      .sort((p, q) => p.d - q.d);

    const keep = new Set();
    let used = 0;
    for (const { a } of candidates) {
      if (used + a.stems.length <= budget) {
        keep.add(a);
        used += a.stems.length;
      }
    }
    for (const a of this.artworks) {
      if (a.audioReady) {
        const inCurrentRoom = !a.room || a.room.state === 'current';
        a.setStemsActive(inCurrentRoom && keep.has(a));
      }
    }
  }

  start() {
    this._started = true;
    this._runLoop();
  }

  _runLoop() {
    const camPos = new THREE.Vector3();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      this.camera.getWorldPosition(camPos);
      const ctx = { app: this, camera: this.camera, cameraPos: camPos, time: t };

      for (const fn of this._updatables) fn(dt, ctx);
      for (const a of this.artworks) a.update(dt, ctx);

      this._stemBudgetAcc += dt;
      if (this._stemBudgetAcc > 0.5) {
        this._stemBudgetAcc = 0;
        this._updateStemBudget();
      }

      this.audio.updateListener(this.camera);
      if (!this.quality.reducedMotion) this.dust.rotation.y += dt * 0.004;
      this.grainPass.uniforms.uTime.value = t;
      this.quality.tick(dt, this);

      this.composer.render();
    });
  }
}
