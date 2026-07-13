import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { AudioEngine } from './AudioEngine.js';

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
 * et onUpdate().
 */
export class App {
  constructor(container) {
    this.container = container;
    this.audio = new AudioEngine();
    this.artworks = [];
    this._updatables = [];
    this._clickHandlers = [];
    this.clock = new THREE.Clock();

    // --- scène ---------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.026);

    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 220
    );
    this.camera.position.set(0, 2.2, 14);

    // --- rendu ---------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    // --- post-processing : bloom + grain -------------------------------
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.9,   // intensité
      0.7,   // rayon
      0.55   // seuil : seules les zones émissives fleurissent
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainVignetteShader);
    this.composer.addPass(this.grainPass);

    this._buildEnvironment();
    this._setupPicking();
    this._setupXR();

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

    // Poussière en suspension
    const count = 450;
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
      const meshes = this.artworks.map((a) => a.hitMesh).filter(Boolean);
      const hits = raycaster.intersectObjects(meshes, true);
      let artwork = null;
      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !obj.userData.artwork) obj = obj.parent;
        artwork = obj?.userData.artwork ?? null;
      }
      for (const h of this._clickHandlers) {
        if (h(artwork, e)) return; // un handler peut consommer le clic
      }
    });
  }

  _setupXR() {
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (!ok) return;
      const btn = VRButton.createButton(this.renderer);
      btn.style.zIndex = 12;
      document.body.appendChild(btn);
    }).catch(() => {});
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

  addArtwork(artwork) {
    this.artworks.push(artwork);
    this.scene.add(artwork.group);
  }

  /** Enregistre un callback appelé à chaque frame : fn(dt, ctx). */
  onUpdate(fn) {
    this._updatables.push(fn);
  }

  /** Enregistre un handler de clic : fn(artworkOuNull, event) → bool (consommé). */
  onArtworkClick(fn) {
    this._clickHandlers.push(fn);
  }

  start() {
    const camPos = new THREE.Vector3();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      this.camera.getWorldPosition(camPos);
      const ctx = { app: this, camera: this.camera, cameraPos: camPos, time: t };

      for (const fn of this._updatables) fn(dt, ctx);
      for (const a of this.artworks) a.update(dt, ctx);

      this.audio.updateListener(this.camera);
      this.dust.rotation.y += dt * 0.004;
      this.grainPass.uniforms.uTime.value = t;

      // L'EffectComposer n'est pas compatible avec le rendu stéréo WebXR :
      // en session VR on rend directement.
      if (this.renderer.xr.isPresenting) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }
    });
  }
}
