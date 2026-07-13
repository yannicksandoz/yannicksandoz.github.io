import * as THREE from 'three';
import { registry } from './ModuleRegistry.js';
import { assetUrl } from './utils.js';

const textureLoader = new THREE.TextureLoader();
let gltfLoaderPromise = null;

/** GLTFLoader chargé à la demande : pas de coût si aucune œuvre n'utilise de modèle. */
function getGltfLoader() {
  if (!gltfLoaderPromise) {
    gltfLoaderPromise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader());
  }
  return gltfLoaderPromise;
}

/**
 * Une œuvre = un groupe Three.js positionné dans la scène + un bus audio +
 * une liste de modules de comportement instanciés depuis sa configuration.
 *
 * Chargement paresseux : le visuel et l'audio ne sont chargés que lorsque la
 * caméra s'approche à moins de `loadDistance` (défaut 50). En attendant, un
 * cadre sombre sert de silhouette.
 */
export class Artwork {
  constructor(config, app) {
    this.config = config;
    this.app = app;

    this.group = new THREE.Group();
    this.group.position.fromArray(config.position ?? [0, 1.8, 0]);
    this.group.rotation.y = THREE.MathUtils.degToRad(config.rotationY ?? 0);
    this.group.userData.artwork = this;

    this.mesh = null;          // mesh final (visuel)
    this.hitMesh = null;       // cible du raycast (défini dès le placeholder)
    this.baseScale = 1;
    this.audioLevel = 0;       // alimenté par AudioReactive

    // état audio : bus → (modules peuvent insérer un panner) → master
    this.bus = null;
    this.stems = [];           // [{ cfg, gain, source, buffer }]
    this.audioReady = false;

    this._visualRequested = false;
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

  /* ----------------------------------------------------------- visuel --- */

  _buildPlaceholder() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x101018, roughness: 0.8, metalness: 0.2,
      emissive: 0x1a1a2e, emissiveIntensity: 0.4
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
        const tex = await textureLoader.loadAsync(assetUrl(cfg.image));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._setMesh(this._buildImageMesh(tex));
      } else if (cfg.model?.type === 'gltf') {
        const loader = await getGltfLoader();
        const gltf = await loader.loadAsync(assetUrl(cfg.model.url));
        const root = gltf.scene;
        root.scale.setScalar(cfg.model.scale ?? 1);
        this._setMesh(root);
      } else if (cfg.model?.shape === 'monolith') {
        this._setMesh(this._buildMonolith(cfg.model));
      } else {
        console.warn(`[galerie] Œuvre ${cfg.id} : ni image ni modèle reconnu.`);
      }
    } catch (err) {
      console.error(`[galerie] Visuel de « ${cfg.id} » impossible à charger :`, err);
    }
  }

  _buildImageMesh(texture) {
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
    mesh.position.y = 0; // le groupe porte déjà la hauteur
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
    this.group.add(mesh);
  }

  /* ------------------------------------------------------------ audio --- */

  async _loadAudio() {
    const engine = this.app.audio;
    const stemCfgs = this.config.stems ?? [];
    if (!stemCfgs.length) { this.audioReady = true; return; }

    try {
      const buffers = await Promise.all(
        stemCfgs.map((s) => engine.load(assetUrl(s.file)))
      );
      const ctx = engine.ctx;

      this.bus = ctx.createGain();
      this.bus.gain.value = this.config.baseGain ?? 1;
      this.bus.connect(engine.master);

      this.stems = stemCfgs.map((cfg, i) => {
        const gain = ctx.createGain();
        gain.gain.value = cfg.gain ?? 1;
        gain.connect(this.bus);
        const source = ctx.createBufferSource();
        source.buffer = buffers[i];
        source.loop = true;
        source.connect(gain);
        return { cfg, gain, source, buffer: buffers[i] };
      });

      // Les modules branchent panner/analyser et prennent la main sur les
      // gains AVANT le démarrage des sources (évite toute bouffée sonore).
      this.audioReady = true;
      for (const m of this.modules) m.onAudioReady?.();
      const t0 = engine.ctx.currentTime + 0.05;
      for (const s of this.stems) s.source.start(t0);
    } catch (err) {
      console.error(`[galerie] Audio de « ${this.config.id} » impossible à charger :`, err);
    }
  }

  /* ------------------------------------------------------------ cycle --- */

  update(dt, ctx) {
    this._distance = ctx.cameraPos.distanceTo(this.group.position);

    // chargement paresseux à l'approche
    const loadDist = this.config.loadDistance ?? 50;
    if (!this._visualRequested && this._distance < loadDist) {
      this._visualRequested = true;
      this._loadVisual();
    }
    if (!this._audioRequested && this.app.audio.unlocked && this._distance < loadDist) {
      this._audioRequested = true;
      this._loadAudio();
    }

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
    for (const s of this.stems) {
      try { s.source.stop(); } catch { /* déjà arrêtée */ }
      s.gain.disconnect();
    }
    this.bus?.disconnect();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.group.removeFromParent();
  }
}
