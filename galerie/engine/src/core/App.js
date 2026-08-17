import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VistaManager } from './Vista.js';
import { FOG_DENSITY } from './RoomManager.js';
import { AudioEngine } from './AudioEngine.js';
import { QualityManager } from './Quality.js';
import { LoadingTracker, assetUrl } from './utils.js';
import { WATER_TIME } from './primitives.js';

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
 * Distorsion de franchissement de portail — un « warp » à la Minecraft :
 * l'image s'aspire vers le centre en tourbillonnant, les canaux rouge et
 * bleu se séparent (aberration chromatique), le pourtour s'assombrit
 * jusqu'au noir au pic — c'est là que la téléportation se produit, puis
 * tout se détend dans la pièce d'arrivée. `uWarp` va de 0 (repos) à 1 (pic).
 */
const WarpShader = {
  uniforms: {
    tDiffuse: { value: null },
    uWarp: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uWarp, uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      float a = atan(c.y, c.x);
      // aspiration radiale + vrille qui s'accentue vers le bord
      float pull = 1.0 - uWarp * 0.75 * r;
      float twist = uWarp * uWarp * 2.6 * r + uWarp * uTime * 1.2;
      vec2 warped = vec2(cos(a + twist), sin(a + twist)) * r * pull + 0.5;
      // aberration chromatique : R et B décalés le long du rayon
      float ca = uWarp * 0.02 * (0.3 + r);
      vec2 dir = r > 0.0001 ? normalize(c) : vec2(0.0);
      vec3 col = vec3(
        texture2D(tDiffuse, warped + dir * ca).r,
        texture2D(tDiffuse, warped).g,
        texture2D(tDiffuse, warped - dir * ca).b
      );
      // fermeture au noir : totale au pic, quel que soit le rayon
      float dark = smoothstep(0.0, 1.0, uWarp * (0.45 + r * 1.6));
      col *= 1.0 - min(1.0, dark + uWarp * uWarp);
      gl_FragColor = vec4(col, 1.0);
    }`
};

/**
 * Cœur minimal : scène, caméra, rendu, post-processing, boucle d'animation.
 * Tout le reste (œuvres, contrôles, éditeur) s'enregistre via addArtwork()
 * et onUpdate(). Le profil de qualité (QualityManager) adapte le pipeline
 * à l'appareil et au framerate mesuré.
 */
export class App {
  /**
   * `headless: true` — pas de WebGL du tout : ni renderer, ni composer, ni
   * picking, ni décor. La scène, les pièces, les œuvres et surtout l'AUDIO
   * fonctionnent à l'identique — c'est ce qui permet à la visite audio de
   * servir de repli quand WebGL2 est indisponible, avec le même moteur.
   */
  constructor(container, { headless = false } = {}) {
    this.container = container;
    this.headless = headless;
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
    // densité relue par pièce (RoomManager.applyFog) : une grande salle a
    // besoin d'un brouillard bien plus ténu pour laisser voir son fond
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 220
    );
    this.camera.position.set(0, 2.2, 14);

    if (headless) {
      // ni rendu, ni décor : la boucle mettra à jour œuvres et auditeur
      this._setupVisibility();
      return;
    }

    // --- rendu ---------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      antialias: profile.antialias,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Étalonné pour un écran à grande plage dynamique (Retina/XDR, OLED).
    // Sur une dalle standard (SDR — LCD d'entrée de gamme), les noirs
    // profonds de la galerie s'écrasent : on relève l'exposition. La
    // requête média est le meilleur signal auto disponible ; ce n'est pas
    // une mesure de luminosité, mais elle sépare bien les deux mondes.
    const hdr = window.matchMedia?.('(dynamic-range: high)').matches;
    this.renderer.toneMappingExposure = hdr ? 1.1 : 1.45;
    container.appendChild(this.renderer.domElement);
    this.quality.refineWithRenderer(this.renderer);
    // Ombres douces (PCF) — une seule source par pièce en projette (la
    // lumière clé, voir RoomManager) : le coût reste borné et prévisible.
    this.renderer.shadowMap.enabled = this.quality.profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
    // Warp de portail : inséré avant la sortie, inactif au repos (une passe
    // désactivée ne coûte rien au composer).
    this.warpPass = new ShaderPass(WarpShader);
    this.warpPass.enabled = false;
    this.composer.addPass(this.warpPass);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainVignetteShader);
    this.grainPass.enabled = this.quality.profile.grain;
    this.composer.addPass(this.grainPass);

    this._buildEnvironment();
    this._setupPicking();
    this._setupVisibility();
    // Apparitions (pièces d'ailleurs sur un plan) — après le renderer :
    // leur rendu vivant dépend de lui et du palier de qualité.
    this.vistas = new VistaManager(this);

    window.addEventListener('resize', () => this._resize());
  }

  /* ------------------------------------------------------------------ */

  _buildEnvironment() {
    // Éclairage d'image (IBL), à la façon du mode Material Preview d'EEVEE :
    // une pièce neutre pré-filtrée (PMREM) sert d'environnement à tous les
    // matériaux standard. C'est elle qui donne aux surfaces leurs reflets et
    // leur modelé — un caillou n'est plus une silhouette plate, un métal
    // accroche la lumière. L'intensité vient du profil de qualité et peut
    // être modulée par pièce (envIntensity, voir RoomManager).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.envBaseIntensity = this.quality.profile.envIntensity ?? 0.5;
    this.scene.environmentIntensity = this.envBaseIntensity;
    pmrem.dispose();

    // L'hémisphérique ne fait plus que teinter (voûte violette / sol sombre) :
    // le remplissage vient de l'environnement, qui modèle bien mieux.
    this.scene.add(new THREE.HemisphereLight(0x2a2a44, 0x0a0a12, 0.5));

    // Le sol appartient désormais aux PIÈCES (RoomManager.buildFloor) :
    // réglable par pièce, désactivable. L'ancien plan global de la scène
    // se superposait au leur — deux surfaces au même y, scintillement
    // garanti. Il n'en reste que la poussière, qui est bien à la scène.

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

  /**
   * Active/coupe les ombres à chaud (gouverneur de FPS, éditeur). Les
   * matériaux compilent des variantes différentes avec/sans ombre : il faut
   * les invalider, sinon le changement ne se voit qu'aux prochains objets.
   */
  setShadowsEnabled(on) {
    if (!this.renderer || this.renderer.shadowMap.enabled === on) return;
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  /**
   * Cibles cliquables de la pièce courante (œuvres + portails).
   * Le sol et les repères ne sont PAS des cibles, et un objet marqué
   * `role: "decor"` non plus — un banc se contourne, il ne s'ouvre pas.
   * En édition, tout redevient sélectionnable : le décor s'édite aussi.
   */
  _pickTargets() {
    const editing = this.editor?.enabled;
    const meshes = this.artworks
      .filter((a) => !a.room || a.room.state === 'current')
      .filter((a) => editing || a.config.role !== 'decor')
      .map((a) => a.hitMesh)
      .filter(Boolean);
    if (this.rooms?.current) meshes.push(...this.rooms.current.portalMeshes);
    return meshes;
  }

  /** Première œuvre ou portail sous un point écran, ou null. */
  pickAt(x, y, raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2()) {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, this.camera);
    const intersections = raycaster.intersectObjects(this._pickTargets(), true);
    let obj = intersections[0]?.object ?? null;
    while (obj && !obj.userData.artwork && !obj.userData.portal) obj = obj.parent;
    if (obj?.userData.artwork) return { type: 'artwork', artwork: obj.userData.artwork };
    if (obj?.userData.portal) return { type: 'portal', portal: obj.userData.portal };
    return null;
  }

  /**
   * « Action » — ce que vise le centre de l'écran, activé au clavier.
   *
   * Le clic exige de pointer ; en marchant à la première personne on
   * regarde déjà l'œuvre, et c'est ce regard qui doit suffire. La barre
   * d'espace passe donc par le MÊME circuit que le clic (mêmes handlers,
   * donc même fiche, même travelling, même priorité à l'éditeur) : rien
   * n'est dupliqué, et Échap ferme comme avant.
   *
   * Une tolérance : si le centre exact ne touche rien, on essaie une
   * petite couronne autour — viser à la souris est précis, viser en
   * marchant ne l'est pas.
   */
  triggerAction() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.06;
    const offsets = [[0, 0], [0, -r], [0, r], [-r, 0], [r, 0]];
    for (const [dx, dy] of offsets) {
      const hit = this.pickAt(cx + dx, cy + dy);
      if (!hit) continue;
      for (const h of this._clickHandlers) {
        if (h(hit, { source: 'action' })) return true;
      }
    }
    return false;
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
      const hit = this.pickAt(e.clientX, e.clientY, raycaster, ndc);
      for (const h of this._clickHandlers) {
        if (h(hit, e)) return; // un handler peut consommer le clic
      }
    });

    // Action au clavier : la barre d'espace agit sur ce que vise le centre
    // de l'écran. Ignorée pendant la saisie, en visite audio (qui a sa
    // propre navigation) et quand un bouton a le focus — sinon Espace
    // l'activerait au lieu d'agir sur l'œuvre.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (this.audioTour?.active) return;
      const el = document.activeElement;
      if (el instanceof Element
          && el.matches('input, textarea, select, button, a, [tabindex]')) return;
      if (this.triggerAction()) e.preventDefault();
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
        this._stopLoop();
        this.audio.suspend();
      } else {
        this.clock.getDelta(); // purge le delta accumulé pendant la pause
        if (this._started) this._runLoop();
        this.audio.resume();
      }
    });
  }

  _stopLoop() {
    if (this.headless) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  _resize() {
    if (this.headless) return;
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
    // approcher une œuvre, c'est la découvrir — sans attendre le palier
    if (module?.artwork) this.progression?.marquer(module.artwork);
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

  /** Enregistre un callback appelé à chaque frame : fn(dt, ctx).
   *  Renvoie la fonction de désabonnement. */
  onUpdate(fn) {
    this._updatables.push(fn);
    return () => {
      const i = this._updatables.indexOf(fn);
      if (i >= 0) this._updatables.splice(i, 1);
    };
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
    if (this.headless) {
      // Même cycle que la boucle rendue, sans composer : mise à jour des
      // œuvres (chargement paresseux, modules), budget de stems, auditeur.
      const camPos = new THREE.Vector3();
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const t = this.clock.elapsedTime;
        this.camera.updateMatrixWorld(true);
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
      };
      tick();
      return;
    }

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

      // Visite audio ouverte : le panneau opaque couvre tout — rendre des
      // images derrière ne ferait que chauffer la machine (et le lecteur
      // d'écran est gourmand). L'audio et les modules continuent, l'image
      // reste sur la dernière trame.
      if (this.audioTour?.active) return;

      if (!this.quality.reducedMotion) this.dust.rotation.y += dt * 0.004;
      // l'eau ondule : UNE horloge partagée par tous les bassins de la
      // scène, bornée pour que sin(t) reste précis sur tous les GPU
      if (!this.quality.reducedMotion) WATER_TIME.value = t % 3600;
      this.grainPass.uniforms.uTime.value = t;
      if (this.warpPass.enabled) this.warpPass.uniforms.uTime.value = t;
      this.quality.tick(dt, this);

      this.vistas?.update(dt); // la pièce apparue se rend avant la vraie
      this.composer.render();
    });
  }
}
