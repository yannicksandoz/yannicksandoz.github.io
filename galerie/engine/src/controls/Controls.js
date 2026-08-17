import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { damp } from '../core/utils.js';

/**
 * Navigation : orbite (souris / tactile) + déplacement clavier ZQSD/WASD +
 * pivot Q/E + joystick virtuel sur écran tactile. Tout le clavier passe par
 * `e.code` (touches physiques) : les mêmes touches marchent en AZERTY, en
 * QWERTY et ailleurs, sans double détection. Le déplacement translate à la
 * fois la caméra et la cible d'orbite, sur le plan horizontal.
 *
 * **Pivot Q/E** — tourner sur place, comme un glissement de souris mais au
 * clavier : la CIBLE tourne autour de la caméra (l'inverse de l'orbite, où
 * la caméra tourne autour de la cible). La vitesse est lissée à l'attaque
 * et à la relâche (damp) pour retrouver l'inertie de la souris, et le
 * déplacement simultané fonctionne puisque les deux entrées sont
 * indépendantes. 120°/s : un tour complet en trois secondes — assez vif
 * pour se retourner, assez calme pour viser une œuvre au casque.
 */
const YAW_SPEED = THREE.MathUtils.degToRad(120);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const EYE = 2.2;       // hauteur des yeux au-dessus du sol foulé
const GROUND_REACH = 40; // portée du rayon de sol (une chute de haut se suit)
const CHEST = 1.15;    // hauteur du rayon de collision au-dessus des pieds :
                       // au-dessus de deux contremarches (2 × 0,5 m), un
                       // escalier se gravit ; un mur ou une masse bloquent
const _rayOrigin = new THREE.Vector3();
const _prevPos = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _tryDir = new THREE.Vector3();
const _local = new THREE.Vector3();
export class Controls {
  constructor(app) {
    this.app = app;
    this.locked = false;   // verrouillé par FocusCamera pendant les travellings
    this.suspended = false; // visite audio : le clavier appartient aux listes HTML
    this.dragging = false; // vrai pendant un drag de gizmo (mode édition)

    this.orbit = new OrbitControls(app.camera, app.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.06;
    // Le regard doit monter au zénith comme il descend aux pieds : dans le
    // belvédère, l'intéressant est DROIT au-dessus de la tête (le plafond
    // et ses escaliers), une butée à 9° du zénith le cachait. On garde un
    // epsilon : à 0 pile, l'azimut d'OrbitControls vrille. La caméra ne
    // passe pas sous le sol pour autant : sa hauteur est tenue par le suivi
    // de sol, qui déplace la cible d'autant — l'assiette est préservée.
    this.orbit.minPolarAngle = 0.015; // ~0,9° du zénith
    this.orbit.maxPolarAngle = Math.PI - 0.015; // et du nadir
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
    this._yawVel = 0; // vitesse de pivot courante (lissée)
    this._groundRay = new THREE.Raycaster();
    this._groundRay.far = 40;
    this._wallRay = new THREE.Raycaster();
    // position en fin de frame précédente : la référence de la collision —
    // tout ce qui a bougé la caméra depuis (clavier, orbite, pan tactile)
    // est corrigé d'un seul geste
    this._lastPos = new THREE.Vector3().copy(app.camera.position);
    this._groundY = null;   // altitude du sol sous les pieds (suivi de sol)
    this._frame = 0;        // les surfaces foulables se relisent une fois/frame
    this._targetsFrame = -1;
    this._targetsCache = [];
    this._murFrame = -1;
    this._murCache = [];
    this._murSpheres = [];
    // Position de la CIBLE d'orbite à la frame précédente. Elle ne bouge
    // qu'à la translation (marche, joystick, pan) et jamais à la rotation :
    // c'est donc elle qui dit si le visiteur AVANCE ou s'il regarde autour.
    this._lastTarget = this.orbit.target.clone();
    this.walking = false;

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
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
    this._frame++;
    if (this.suspended) {
      // La visite audio garde l'orbite à jour (FocusCamera pilote la cible)
      // mais ne lit ni clavier ni joystick : les flèches parcourent les
      // listes, pas la scène.
      this.orbit.enabled = false;
      this.orbit.update();
      // la visite audio déplace la caméra d'œuvre en œuvre : on garde la
      // référence de collision à jour, sinon le retour en 3D produirait un
      // faux « déplacement » de plusieurs mètres
      this._lastPos.copy(this.app.camera.position);
      this._groundY = null;
      return;
    }
    if (!this.locked) {
      // — pivot Q/E : tourner sur place —
      const yawInput = (this._keys.has('KeyQ') ? 1 : 0) - (this._keys.has('KeyE') ? 1 : 0);
      this._yawVel = damp(this._yawVel, yawInput * YAW_SPEED, 12, dt);
      if (Math.abs(this._yawVel) > 0.001) {
        const cam = this.app.camera.position;
        const toTarget = this.orbit.target.clone().sub(cam);
        toTarget.applyAxisAngle(UP, this._yawVel * dt);
        this.orbit.target.copy(cam).add(toTarget);
      }

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
    // APRÈS l'orbite : tout le déplacement de la frame est passé (clavier,
    // joystick, pan à deux doigts) — on le corrige d'un seul geste, par
    // rapport à la position de FIN de frame précédente.
    this._collide();
    this._keepInside();
    this._followGround(dt);
    this._lastPos.copy(this.app.camera.position);
    // Marche-t-on vraiment ? La cible d'orbite ne se déplace qu'à la
    // translation. Tourner la caméra fait pourtant VOYAGER la caméra (elle
    // orbite autour de la cible) : sans ce départage, un simple coup d'œil
    // en arrivant dans une pièce poussait la tête dans le portail d'à côté
    // et l'on repartait aussitôt. Les zones ne s'ouvrent qu'à qui avance.
    this.walking = this.orbit.target.distanceToSquared(this._lastTarget) > 1e-6;
    this._lastTarget.copy(this.orbit.target);
  }

  /**
   * Bord du monde : on ne quitte pas la pièce.
   *
   * Les murs suffisent quand il y en a — mais un parvis, un jardin, une
   * allée n'en ont pas, et rien n'empêchait alors de marcher au-delà du sol
   * et de continuer dans le vide. La position est ramenée dans l'emprise du
   * sol, en coordonnées LOCALES de la pièce : ainsi la limite tourne avec
   * elle quand un mur devient le sol (Escher).
   */
  _keepInside() {
    const app = this.app;
    if (this.locked || this.suspended || this.dragging) return;
    if (app.editor?.enabled) return;          // en édition, on survole tout
    if (app.rooms?._transitioning) return;
    const room = app.rooms?.current;
    const b = app.rooms?.boundsLocal?.(room);
    if (!b || !room) return;

    const cam = app.camera.position;
    _local.copy(cam);
    room.group.worldToLocal(_local);
    const x = THREE.MathUtils.clamp(_local.x, -b.half, b.half);
    const z = THREE.MathUtils.clamp(_local.z, -b.half, b.half);
    // l'axe local Y aussi : sur un plan basculé, c'est une direction de
    // marche, et rien d'autre ne la retient
    const y = THREE.MathUtils.clamp(_local.y, b.yMin, b.yMax);
    if (x === _local.x && z === _local.z && y === _local.y) return;
    _local.x = x;
    _local.z = z;
    _local.y = y;
    room.group.localToWorld(_local);
    _delta.copy(_local).sub(cam);
    cam.add(_delta);
    this.orbit.target.add(_delta);           // la cible suit, sinon le regard bascule
  }

  /**
   * Surfaces foulables de la pièce courante, relues une fois par frame —
   * avec leur sphère englobante en coordonnées MONDE.
   *
   * Ces sphères ne sont pas un luxe : `Raycaster.far` n'est pas consulté par
   * le test de sphère d'un InstancedMesh (three r166). Sans elles, un rayon
   * de cinquante centimètres parcourt quand même toutes les instances de
   * toutes les masses de la pièce. On fait donc respecter la portée
   * nous-mêmes, en écartant d'emblée ce qui est trop loin.
   *
   * Recalculées chaque frame et non mémorisées par pièce : une bascule fait
   * tourner le groupe de la pièce, et l'éditeur reconstruit les voxels — un
   * cache serait périmé sans prévenir.
   */
  _targets(reach = 0, genre = 'sol') {
    // deux listes, deux usages : `sol` (rayon vertical : ce qu'on foule) et
    // `mur` (rayon horizontal : ce qui arrête, panneaux et vitres compris)
    const cache = genre === 'mur' ? '_murCache' : '_targetsCache';
    const spheres = genre === 'mur' ? '_murSpheres' : '_spheres';
    const frame = genre === 'mur' ? '_murFrame' : '_targetsFrame';
    if (this[frame] !== this._frame) {
      this[frame] = this._frame;
      const rooms = this.app.rooms;
      const list = (genre === 'mur' ? rooms?.blockers?.() : rooms?.walkables?.()) ?? [];
      this[cache] = list;
      this[spheres] = list.map((o) => {
        const g = o.geometry;
        if (!g) return null;
        if (o.isInstancedMesh) {
          if (!o.boundingSphere) o.computeBoundingSphere();
          if (!o.boundingSphere) return null;
          return o.boundingSphere.clone().applyMatrix4(o.matrixWorld);
        }
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingSphere) return null;
        return g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      });
    }
    if (reach <= 0) return this[cache];
    const from = this.app.camera.position;
    return this[cache].filter((o, i) => {
      const s = this[spheres][i];
      if (!s) return true;                  // sphère inconnue : on n'écarte pas
      const d = s.radius + reach;
      return s.center.distanceToSquared(from) <= d * d;
    });
  }

  /**
   * À appeler après avoir déplacé la caméra AUTREMENT qu'en marchant
   * (téléportation d'un portail, fin de bascule, point d'arrivée) : sans
   * cela, le saut serait pris pour un pas et la collision l'annulerait.
   * Un signal explicite vaut mieux qu'un seuil de distance, qui laissait
   * passer les grands pas et refusait les petites téléportations.
   */
  resyncCollision() {
    this._lastPos.copy(this.app.camera.position);
    this._lastTarget.copy(this.orbit.target);
    this.walking = false;
    this._groundY = null;
  }

  /**
   * Collision : on ne traverse ni les murs ni la masse d'un escalier. Le
   * déplacement de la frame est rejoué par un rayon à hauteur de poitrine ;
   * s'il rencontre une surface foulable, on tente de GLISSER (axe X puis Z),
   * sinon on reste sur place. Sous deux contremarches (~1,1 m), rien ne
   * bloque : les escaliers se gravissent, les murs s'imposent.
   */
  _collide() {
    const app = this.app;
    if (this.locked || this.suspended || this.dragging) return;
    if (app.editor?.enabled) return;
    if (app.rooms?._transitioning) return;
    const cam = app.camera.position;
    _prevPos.copy(this._lastPos);
    _delta.copy(cam).sub(_prevPos);
    _delta.y = 0;
    const len = _delta.length();
    if (len < 1e-4) return;              // immobile : rien à corriger
    const targets = this._targets(len + 0.6, 'mur');
    if (!targets.length) return;

    // Hauteur du rayon : mesurée depuis le SOL RÉEL sous les pieds, jamais
    // depuis la caméra. En montant vite, la hauteur d'yeux est amortie et
    // traîne sous la pente : partir d'elle ferait plonger le rayon dans les
    // marches, et l'escalier deviendrait un mur.
    const ground = this._groundY ?? (_prevPos.y - EYE);
    const feetY = ground + CHEST;
    const blocked = (dx, dz, dist) => {
      _tryDir.set(dx, 0, dz).normalize();
      _rayOrigin.set(_prevPos.x, feetY, _prevPos.z);
      this._wallRay.set(_rayOrigin, _tryDir);
      this._wallRay.far = dist + 0.35;
      return this._wallRay.intersectObjects(targets, true).length > 0;
    };

    if (!blocked(_delta.x, _delta.z, len)) return;
    // glissement : on garde la composante qui passe
    if (Math.abs(_delta.x) > 1e-4 && !blocked(_delta.x, 0, Math.abs(_delta.x))) {
      cam.z = _prevPos.z;
      this.orbit.target.z -= _delta.z;
      return;
    }
    if (Math.abs(_delta.z) > 1e-4 && !blocked(0, _delta.z, Math.abs(_delta.z))) {
      cam.x = _prevPos.x;
      this.orbit.target.x -= _delta.x;
      return;
    }
    // bloqué net : on annule le déplacement horizontal de la frame
    cam.x = _prevPos.x;
    cam.z = _prevPos.z;
    this.orbit.target.x -= _delta.x;
    this.orbit.target.z -= _delta.z;
  }

  /**
   * Suivi du sol : la caméra épouse ce qu'elle foule — plancher, mur devenu
   * sol (Escher) et surtout ESCALIERS (`walkable: true` sur l'objet). Un
   * rayon part des genoux vers le bas ; la hauteur d'yeux est lissée, les
   * marches deviennent une pente douce. Le rayon part BAS (60 cm au-dessus
   * des yeux) : une volée d'escalier qui passe au-dessus de la tête ne doit
   * pas nous téléporter dessus.
   *
   * Le lissage est ASYMÉTRIQUE : on gravit une marche d'un pas (montée
   * franche), on redescend en douceur. Un amortissement symétrique assez
   * lent pour rendre la descente agréable ferait traîner la caméra sous la
   * pente en montée — et la collision, qui se mesure depuis le sol, s'en
   * trouverait faussée.
   */
  _followGround(dt) {
    const app = this.app;
    if (this.locked || this.suspended || this.dragging) return;
    if (app.editor?.enabled) return;          // en édition, on vole
    if (app.rooms?._transitioning) return;    // une bascule pilote la caméra
    const targets = this._targets(GROUND_REACH);
    if (!targets.length) return;
    const cam = app.camera.position;
    _rayOrigin.set(cam.x, cam.y + 0.6, cam.z);
    this._groundRay.set(_rayOrigin, DOWN);
    this._groundRay.far = GROUND_REACH;   // reposé à chaque frame : un rayon
                                          // partagé est un rayon qu'on retrouve
                                          // réglé par quelqu'un d'autre
    const hit = this._groundRay.intersectObjects(targets, true)[0];
    if (!hit) return; // hors de tout : on garde l'altitude
    this._groundY = hit.point.y;               // référence de la collision
    const eye = hit.point.y + EYE;
    const y = damp(cam.y, eye, eye > cam.y ? 22 : 9, dt);
    const dy = y - cam.y;
    if (Math.abs(dy) > 1e-4) {
      cam.y = y;
      this.orbit.target.y += dy;
    }
  }
}
