import * as THREE from 'three';
import { registry } from './ModuleRegistry.js';

// crossOrigin « anonymous » : indispensable pour les médias distants, dont
// les pixels doivent être lisibles par WebGL (l'hôte doit autoriser le CORS).
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');
let gltfLoaderPromise = null;

/** GLTFLoader chargé à la demande : pas de coût si aucune œuvre n'utilise de modèle. */
function getGltfLoader() {
  if (!gltfLoaderPromise) {
    gltfLoaderPromise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader());
  }
  return gltfLoaderPromise;
}

/** Redimensionne une texture au plafond du profil (mémoire GPU mobile). */
function capTextureSize(texture, maxSize) {
  const img = texture.image;
  if (!img || Math.max(img.width, img.height) <= maxSize) return texture;
  const scale = maxSize / Math.max(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Une œuvre = un groupe Three.js positionné dans une pièce + un bus audio +
 * une liste de modules de comportement instanciés depuis sa configuration.
 *
 * Visuels possibles : image (plan texturé), vidéo (plan + VideoTexture,
 * playsinline/muted pour iOS, son routé dans le bus spatialisé via
 * MediaElementSource), modèle GLTF, ou primitive shader « monolith ».
 *
 * Cycle des assets : chargement sous `loadDistance`, libération au-delà de
 * 1,6 × ; les pièces lointaines forcent la libération (forceUnload) et les
 * pièces adjacentes préchargent sans jouer (setStemsActive / setVideoPlaying
 * pilotés par App et RoomManager).
 */
export class Artwork {
  constructor(config, app) {
    this.config = config;
    this.app = app;
    this.room = null; // renseigné par App.addArtwork

    this.group = new THREE.Group();
    this.group.position.fromArray(config.position ?? [0, 1.8, 0]);
    this.group.rotation.y = THREE.MathUtils.degToRad(config.rotationY ?? 0);
    this.group.scale.setScalar(config.scale ?? 1);
    this.group.userData.artwork = this;

    this.mesh = null;          // mesh final (visuel)
    this.hitMesh = null;       // cible du raycast (défini dès le placeholder)
    this.baseScale = 1;        // échelle du mesh (la pulsation la module)
    this.audioLevel = 0;       // alimenté par AudioReactive

    // état audio : bus → (modules peuvent insérer un panner) → master
    this.bus = null;
    this.stems = [];           // [{ cfg, gain, source, buffer }]
    this.audioReady = false;
    this._stemsActive = false;

    this._video = null;
    this._mediaSrc = null;
    this.mediaError = null; // message si un média est illisible (CORS, 404…)

    this._visualRequested = false;
    this._visualLoaded = false;
    this._audioRequested = false;
    this._distance = Infinity;

    this._buildPlaceholder();

    // Lumière d'appoint propre à l'œuvre (pilotable par AudioReactive)
    const lightColor = config.lightColor ?? '#7a6cff';
    this.light = new THREE.PointLight(new THREE.Color(lightColor), 4, 14, 1.8);
    this.light.position.set(0, 0.4, 1.6);
    this.group.add(this.light);
    this.lightBaseIntensity = this.light.intensity;

    // instanciation des modules déclarés dans la config
    this.modules = (config.modules ?? [])
      .map((m) => registry.create(m.type, this, m.params, app))
      .filter(Boolean);
    for (const m of this.modules) m.init();
  }

  /** Chemin de config → URL réelle (les imports de l'éditeur sont des blobs). */
  _resolve(path) {
    return this.app.resolveAsset(path);
  }

  /* ----------------------------------------------------------- visuel --- */

  _buildPlaceholder() {
    // En cas de média illisible, le placeholder vire au rouge sourd :
    // repère visuel immédiat dans l'éditeur, discret en visite.
    const mat = new THREE.MeshStandardMaterial({
      color: this.mediaError ? 0x1c0c10 : 0x101018,
      roughness: 0.8, metalness: 0.2,
      emissive: this.mediaError ? 0x4a1020 : 0x1a1a2e,
      emissiveIntensity: this.mediaError ? 0.6 : 0.4
    });
    const size = this.config.size ?? [4, 4];
    const geo = this.config.model
      ? new THREE.BoxGeometry(1.2, this.config.model.height ?? 4, 1.2)
      : new THREE.PlaneGeometry(size[0], size[1]);
    this.hitMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.hitMesh);
    this._placeholder = this.hitMesh;
  }

  async _loadVisual() {
    const cfg = this.config;
    try {
      if (cfg.image) {
        const tex = await this.app.loading.track(
          textureLoader.loadAsync(this._resolve(cfg.image))
        );
        capTextureSize(tex, this.app.quality.profile.maxTextureSize);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._setMesh(this._buildPanelMesh(tex));
      } else if (cfg.video) {
        this._setMesh(this._buildVideoMesh());
      } else if (cfg.model?.type === 'gltf') {
        const loader = await getGltfLoader();
        const gltf = await this.app.loading.track(
          loader.loadAsync(this._resolve(cfg.model.url))
        );
        const root = gltf.scene;
        root.scale.setScalar(cfg.model.scale ?? 1);
        this._setMesh(root);
      } else if (cfg.model?.shape === 'monolith') {
        this._setMesh(this._buildMonolith(cfg.model));
      } else {
        console.warn(`[galerie] Œuvre ${cfg.id} : ni image, ni vidéo, ni modèle reconnu.`);
      }
      this._visualLoaded = true;
      this._clearMediaError();
    } catch (err) {
      // échec non fatal : l'œuvre garde son placeholder, la visite continue.
      // Cause fréquente pour une URL distante : CORS refusé, 404 ou réseau.
      console.error(`[galerie] Visuel de « ${cfg.id} » impossible à charger :`, err);
      this.setMediaError(`visuel illisible (${cfg.image ?? cfg.video ?? cfg.model?.url ?? '?'})`);
    }
  }

  /** Signale un média illisible : placeholder rouge + message pour l'éditeur. */
  setMediaError(message) {
    this.mediaError = message;
    if (this._placeholder) {
      this._placeholder.material.color.set(0x1c0c10);
      this._placeholder.material.emissive.set(0x4a1020);
      this._placeholder.material.emissiveIntensity = 0.6;
    }
  }

  _clearMediaError() {
    this.mediaError = null;
  }

  _unloadVisual() {
    if (!this.mesh) return;
    if (this._video) {
      this._video.pause();
      this._mediaSrc?.disconnect();
      this._mediaSrc = null;
      this._video.removeAttribute('src');
      this._video.load();
      this._video = null;
    }
    this.group.remove(this.mesh);
    this.mesh.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          m.map?.dispose();
          m.emissiveMap?.dispose();
          m.dispose();
        });
      }
    });
    this.mesh = null;
    this._reactiveMaterial = null;
    this._visualLoaded = false;
    this._visualRequested = false;
    this._buildPlaceholder();
  }

  _buildPanelMesh(texture) {
    const [w, h] = this.config.size ?? [4, 4];
    const holder = new THREE.Group();

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 0.55, // l'image « éclaire » doucement — base du bloom
        side: THREE.DoubleSide
      })
    );
    holder.add(panel);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.4, metalness: 0.7 })
    );
    frame.position.z = -0.05;
    holder.add(frame);

    this._reactiveMaterial = panel.material;
    this._baseEmissive = panel.material.emissiveIntensity;
    return holder;
  }

  /**
   * Plan vidéo : playsinline + muted autorisent l'autoplay iOS. Si
   * `videoSound` est vrai, le son est routé dans le bus spatialisé de
   * l'œuvre (MediaElementSource) après le déblocage audio.
   */
  _buildVideoMesh() {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = this._resolve(this.config.video);
    this._video = video;
    if (!this.room || this.room.isCurrent) {
      video.play().catch(() => { /* rejouera au prochain setVideoPlaying */ });
    }

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = this._buildPanelMesh(texture);
    this._tryAttachVideoAudio();
    return mesh;
  }

  _tryAttachVideoAudio() {
    if (!this.config.videoSound || !this._video || this._mediaSrc) return;
    if (!this.bus || !this.app.audio.unlocked) return;
    try {
      this._mediaSrc = this.app.audio.ctx.createMediaElementSource(this._video);
      this._mediaSrc.connect(this.bus);
      this._video.muted = false;
    } catch (err) {
      console.warn(`[galerie] Son vidéo de « ${this.config.id} » indisponible :`, err);
    }
  }

  /** Lecture/pause de la vidéo selon la pièce active (batterie + décodeur). */
  setVideoPlaying(active) {
    if (!this._video) return;
    if (active) this._video.play().catch(() => {});
    else this._video.pause();
  }

  _buildMonolith(params) {
    const height = params.height ?? 4;
    const color = new THREE.Color(params.color ?? '#66f0d8');
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uColor: { value: color }
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uAudio;
        varying vec3 vPos, vNormal, vView;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec3 p = position + normal * uAudio * 0.06 * sin(position.y * 5.0 + uTime * 2.5);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAudio;
        uniform vec3 uColor;
        varying vec3 vPos, vNormal, vView;
        void main() {
          float bands = smoothstep(0.42, 0.5, abs(fract(vPos.y * 1.6 - uTime * 0.12) - 0.5));
          float fresnel = pow(1.0 - abs(dot(normalize(vView), normalize(vNormal))), 2.2);
          vec3 col = uColor * 0.05
                   + uColor * bands * (0.25 + uAudio * 2.8)
                   + uColor * fresnel * (0.25 + uAudio * 1.4);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, height, 1.1, 1, 24, 1), mat);
    this._reactiveMaterial = mat;
    return mesh;
  }

  _setMesh(mesh) {
    if (this._placeholder) {
      this.group.remove(this._placeholder);
      this._placeholder.geometry.dispose();
      this._placeholder.material.dispose();
      this._placeholder = null;
    }
    this.mesh = mesh;
    this.hitMesh = mesh;
    mesh.scale.setScalar(this.baseScale);
    this.group.add(mesh);
  }

  /* ------------------------------------------------------------ audio --- */

  async _loadAudio() {
    const engine = this.app.audio;
    const stemCfgs = this.config.stems ?? [];
    if (!stemCfgs.length && !this.config.videoSound) return;

    try {
      const buffers = await Promise.all(
        stemCfgs.map((s) => this.app.loading.track(engine.load(this._resolve(s.file))))
      );
      const ctx = engine.ctx;

      this.bus = ctx.createGain();
      this.bus.gain.value = this.config.baseGain ?? 1;
      this.bus.connect(engine.master);

      this.stems = stemCfgs.map((cfg, i) => {
        const gain = ctx.createGain();
        gain.gain.value = cfg.gain ?? 1;
        gain.connect(this.bus);
        return { cfg, gain, source: null, buffer: buffers[i] };
      });

      // Les modules branchent panner/analyser et prennent la main sur les
      // gains avant tout démarrage de source (évite toute bouffée sonore).
      this.audioReady = true;
      for (const m of this.modules) m.onAudioReady?.();
      this._tryAttachVideoAudio();
      // Le démarrage effectif est décidé par le budget de stems de l'App.
    } catch (err) {
      // idem visuel : on n'interrompt pas la visite pour un stem manquant
      console.error(`[galerie] Audio de « ${this.config.id} » impossible à charger :`, err);
      this.setMediaError('son illisible (réseau, CORS ou format)');
    }
  }

  /**
   * Active/suspend les sources (appelé par App._updateStemBudget). Les stems
   * d'une même œuvre démarrent au même instant pour rester en phase.
   */
  setStemsActive(active) {
    if (!this.audioReady || active === this._stemsActive) return;
    this._stemsActive = active;
    const ctx = this.app.audio.ctx;
    if (active) {
      const t0 = ctx.currentTime + 0.05;
      for (const s of this.stems) {
        const src = ctx.createBufferSource();
        src.buffer = s.buffer;
        src.loop = true;
        src.connect(s.gain);
        src.start(t0);
        s.source = src;
      }
    } else {
      for (const s of this.stems) {
        try { s.source?.stop(); } catch { /* déjà arrêtée */ }
        s.source?.disconnect();
        s.source = null;
      }
    }
  }

  _unloadAudio() {
    this.setStemsActive(false);
    for (const m of this.modules) m.onAudioReleased?.();
    for (const s of this.stems) {
      s.gain.disconnect();
      this.app.audio.release(this._resolve(s.cfg.file));
    }
    this.bus?.disconnect();
    this.bus = null;
    this.stems = [];
    this.audioReady = false;
    this._audioRequested = false;
  }

  /** Libération totale (pièce lointaine ou suppression). */
  forceUnload() {
    if (this._visualLoaded) this._unloadVisual();
    if (this.audioReady) this._unloadAudio();
  }

  /** Rayon au-delà duquel l'œuvre est inaudible (pour le budget de stems). */
  get maxAudibleRadius() {
    let r = 0;
    for (const s of this.config.stems ?? []) r = Math.max(r, s.radius ?? 12);
    for (const m of this.config.modules ?? []) {
      if (m.type === 'SpatialCrossfade') r = Math.max(r, m.params?.radius ?? 15);
      if (m.type === 'HRTFPanner') r = Math.max(r, m.params?.maxDistance ?? 40);
    }
    return r || 15;
  }

  /* ------------------------------------------------------------ cycle --- */

  update(dt, ctx) {
    const roomState = this.room?.state ?? 'current';
    if (roomState === 'far') {
      this.forceUnload();
      return;
    }

    this._distance = ctx.cameraPos.distanceTo(this.group.position);

    // chargement paresseux à l'approche, libération au-delà
    const loadDist = this.config.loadDistance ?? 50;
    const unloadDist = loadDist * 1.6;
    if (!this._visualRequested && this._distance < loadDist) {
      this._visualRequested = true;
      this._loadVisual();
    }
    if (!this._audioRequested && this.app.audio.unlocked && this._distance < loadDist) {
      this._audioRequested = true;
      this._loadAudio();
    }
    if (this._distance > unloadDist) {
      if (this._visualLoaded) this._unloadVisual();
      if (this.audioReady) this._unloadAudio();
    }

    if (roomState !== 'current') return; // pièce adjacente : préchargée, inactive

    if (this._reactiveMaterial?.uniforms?.uTime) {
      this._reactiveMaterial.uniforms.uTime.value = ctx.time;
    }

    for (const m of this.modules) m.update(dt, { ...ctx, distance: this._distance });
  }

  get distance() {
    return this._distance;
  }

  /**
   * Point d'entrée unique pour la réactivité audio (module AudioReactive) :
   * pilote pulsation d'échelle, émission du matériau, uniform de shader
   * et intensité de la lumière d'appoint.
   */
  setAudioLevel(level, { pulseScale = 0, emissiveBoost = 0, lightBoost = 2.5 } = {}) {
    this.audioLevel = level;
    if (this.mesh && pulseScale) {
      this.mesh.scale.setScalar(this.baseScale * (1 + level * pulseScale));
    }
    const mat = this._reactiveMaterial;
    if (mat) {
      if (mat.uniforms?.uAudio) mat.uniforms.uAudio.value = level;
      if (mat.emissiveIntensity !== undefined && emissiveBoost) {
        mat.emissiveIntensity = (this._baseEmissive ?? 0.5) + level * emissiveBoost;
      }
    }
    if (this.light) {
      this.light.intensity = this.lightBaseIntensity * (1 + level * lightBoost);
    }
  }

  /** Transmis par le picker central de l'App (voir main.js). */
  handleClick() {
    for (const m of this.modules) {
      if (m.onClick?.()) return true;
    }
    return false;
  }

  dispose() {
    for (const m of this.modules) m.dispose();
    this.forceUnload();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.group.removeFromParent();
  }
}
