import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Navigation : orbite (souris / tactile) + déplacement clavier ZQSD/WASD
 * (e.code = touches physiques, donc identique en AZERTY et QWERTY) +
 * joystick virtuel sur écran tactile. Le déplacement translate à la fois
 * la caméra et la cible d'orbite, sur le plan horizontal.
 */
export class Controls {
  constructor(app) {
    this.app = app;
    this.locked = false;   // verrouillé par FocusCamera pendant les travellings
    this.dragging = false; // vrai pendant un drag de gizmo (mode édition)

    this.orbit = new OrbitControls(app.camera, app.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.06;
    this.orbit.maxPolarAngle = Math.PI * 0.52; // ne pas passer sous le sol
    this.orbit.minDistance = 0.5;
    this.orbit.maxDistance = 30;
    this.orbit.target.set(0, 1.8, 8);
    // Tactile : 1 doigt = rotation, 2 doigts = déplacement (pan) + zoom (pincement).
    // Pan sur le plan horizontal uniquement (on « marche », on ne vole pas).
    this.orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.orbit.screenSpacePanning = false;

    this.speed = 7;
    this._keys = new Set();
    this._joyVec = new THREE.Vector2();

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      this._keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
    window.addEventListener('blur', () => this._keys.clear());

    this._setupJoystick();
  }

  _setupJoystick() {
    const zone = document.getElementById('joystick');
    const nub = document.getElementById('joystick-nub');
    if (!zone) return;
    if (window.matchMedia('(pointer: coarse)').matches) zone.hidden = false;

    let activeId = null;
    const RADIUS = 60; // px

    const setNub = (dx, dy) => {
      nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };

    zone.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      zone.setPointerCapture(activeId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      const rect = zone.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
      setNub(dx, dy);
      this._joyVec.set(dx / RADIUS, dy / RADIUS);
    });
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      this._joyVec.set(0, 0);
      setNub(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _moveInput() {
    const k = this._keys;
    let x = 0, z = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;    // Z en AZERTY
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;  // Q en AZERTY
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    x += this._joyVec.x;
    z -= this._joyVec.y;
    return { x: THREE.MathUtils.clamp(x, -1, 1), z: THREE.MathUtils.clamp(z, -1, 1) };
  }

  update(dt) {
    if (!this.locked) {
      const { x, z } = this._moveInput();
      if (x || z) {
        const cam = this.app.camera;
        const fwd = new THREE.Vector3();
        cam.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        const boost = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? 2.2 : 1;
        const move = new THREE.Vector3()
          .addScaledVector(fwd, z)
          .addScaledVector(right, x)
          .normalize()
          .multiplyScalar(this.speed * boost * dt);
        cam.position.add(move);
        this.orbit.target.add(move);
      }
    }
    this.orbit.enabled = !this.locked && !this.dragging;
    this.orbit.update();
  }
}
