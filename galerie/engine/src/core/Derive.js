import * as THREE from 'three';
import { t, onLangChange } from './i18n.js';
import { easeInOutCubic } from './utils.js';

/**
 * « Laisse-toi porter » — la visite guidée.
 *
 * Une dérive douce de la caméra, d'œuvre en œuvre : elle vole jusqu'à un
 * point de vue face à l'œuvre, s'y pose le temps d'écouter, repart. Quand
 * la pièce n'a plus rien à montrer, elle gagne le portail le plus
 * prometteur et poursuit dans la pièce suivante. Les œuvres non encore
 * découvertes passent d'abord ; une fois la galerie entière connue, la
 * dérive continue en boucle — un mode ambiant, fait pour être regardé
 * (et capturé en vidéo) autant que piloté.
 *
 * LE VISITEUR EST TOUJOURS PRIORITAIRE : un geste — touche, clic, molette,
 * doigt — et la dérive s'efface, la main revient. Le bouton la relance.
 *
 * prefers-reduced-motion : pas de long travelling — des déplacements quasi
 * instantanés, et les pauses font le rythme.
 */

const VUE_DIST = 5;      // recul du point de vue face à l'œuvre
const PAUSE = 9;         // secondes devant chaque œuvre
const VITESSE = 4.5;     // m/s de croisière

export class Derive {
  constructor(app) {
    this.app = app;
    this.active = false;
    this._phase = 'idle';   // idle | vol | pause
    this._t = 0;
    this._duree = 1;
    this._attente = 0;
    this._cible = null;     // { pos, target, puis } — puis : rappel à l'arrivée
    this._de = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._vers = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._sallesVues = new Set();
    this._v = new THREE.Vector3();

    this._bouton = this._construireBouton();
    this._off = app.onUpdate((dt) => this._tick(dt));

    // La main revient au moindre geste. Deux nuances : un CLIC sur un
    // bouton ou dans le menu n'est pas un geste de reprise (on règle
    // quelque chose) ; une TOUCHE, si — sauf champ de saisie et menu.
    // (Le bouton de dérive garde le focus après le clic qui l'a lancée :
    // sans cette distinction, les touches semblaient ignorées.)
    this._stopPointeur = (e) => {
      if (!this.active) return;
      if (e.target instanceof Element
        && e.target.closest('button, a, input, #visit-menu')) return;
      this.arreter();
    };
    this._stopTouche = (e) => {
      if (!this.active) return;
      if (e.target instanceof Element
        && e.target.closest('input, textarea, select, #visit-menu')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        // Entrée/Espace sur un bouton focalisé : c'est un clic, pas un geste
        if (e.target instanceof Element && e.target.closest('button, a')) return;
      }
      this.arreter();
    };
    window.addEventListener('pointerdown', this._stopPointeur, true);
    window.addEventListener('wheel', this._stopPointeur, { passive: true });
    window.addEventListener('keydown', this._stopTouche, true);
  }

  _construireBouton() {
    const b = document.createElement('button');
    b.id = 'derive-btn';
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const peindre = () => {
      b.textContent = this.active ? `❚❚ ${t('derive.stop')}` : `▸ ${t('derive.start')}`;
      b.setAttribute('aria-pressed', String(this.active));
    };
    peindre();
    this._peindreBouton = peindre;
    onLangChange(peindre);
    b.addEventListener('click', () => (this.active ? this.arreter() : this.demarrer()));
    document.body.appendChild(b);
    return b;
  }

  demarrer() {
    if (this.active) return;
    this.active = true;
    this.app.activeFocus?.release?.();
    this.app.controls.locked = true;      // la caméra appartient à la dérive
    this._sallesVues.clear();
    this._phase = 'idle';
    this._peindreBouton();
  }

  arreter() {
    if (!this.active) return;
    this.active = false;
    this._phase = 'idle';
    this._cible = null;
    this.app.controls.locked = false;
    this.app.controls.resyncCollision?.();
    this._peindreBouton();
  }

  /* ------------------------------------------------------ itinéraire --- */

  /** Œuvres qui restent à voir ici — toutes, si la galerie est connue. */
  _oeuvresDe(room) {
    const prog = this.app.progression;
    const toutes = (room.artworks ?? []).filter((a) => a.config.role !== 'decor');
    if (!prog) return toutes;
    const fraiches = toutes.filter((a) => !prog.estDecouverte(a));
    return prog.complet || fraiches.length === 0 ? toutes : fraiches;
  }

  _prochaine() {
    const rooms = this.app.rooms;
    const room = rooms?.current;
    if (!room) return null;
    const cam = this.app.camera.position;

    // 1. l'œuvre la plus proche qui reste à voir dans cette pièce
    const restantes = this._oeuvresDe(room)
      .filter((a) => a !== this._derniere)
      .map((a) => ({ a, d: a.group.getWorldPosition(this._v).distanceTo(cam) }))
      .sort((p, q) => p.d - q.d);
    if (restantes.length && !this._sallesVues.has(room.config.id + '·faite')) {
      const { a } = restantes[0];
      const wp = a.group.getWorldPosition(new THREE.Vector3());
      const dir = cam.clone().sub(wp).setY(0);
      if (dir.lengthSq() < 0.04) dir.set(0, 0, 1).applyQuaternion(a.group.quaternion);
      dir.normalize();
      const pos = wp.clone().addScaledVector(dir, VUE_DIST);
      pos.y = wp.y + 0.9;
      this._derniere = a;
      // dernière œuvre de la pièce : marquer la salle comme faite après elle
      if (restantes.length === 1) this._sallesVues.add(room.config.id + '·faite');
      return { pos, target: wp, pause: PAUSE };
    }

    // 2. plus rien ici : gagner le portail le plus prometteur
    const portails = (room.portalMeshes ?? [])
      .map((m) => ({ m, p: m.userData.portal }))
      .filter((x) => x.p);
    if (!portails.length) { this.arreter(); return null; }
    const inconnue = (x) => {
      const cible = this.app.rooms.rooms.get(x.p.cfg?.to ?? x.p.to);
      return cible && !this._sallesVues.has(cible.config.id) ? 0 : 1;
    };
    portails.sort((x, y) => inconnue(x) - inconnue(y)
      || x.m.getWorldPosition(this._v).distanceTo(cam)
      - y.m.getWorldPosition(new THREE.Vector3()).distanceTo(cam));
    const { m, p } = portails[0];
    this._sallesVues.add(room.config.id);
    this._sallesVues.delete(room.config.id + '·faite'); // on pourra y revenir
    const wp = m.getWorldPosition(new THREE.Vector3());
    const dir = cam.clone().sub(wp).setY(0).normalize();
    const pos = wp.clone().addScaledVector(dir, 1.6);
    pos.y = wp.y + 2.0;
    this._derniere = null;
    return { pos, target: wp, pause: 0, puis: () => this._franchir(p) };
  }

  async _franchir(portal) {
    this._phase = 'porte';                 // en suspens pendant le warp
    await this.app.rooms.traverse(portal);
    for (let k = 0; k < 40 && this.app.rooms._transitioning; k++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.active) this._phase = 'idle'; // et la dérive repart d'ici
  }

  /* ------------------------------------------------------------ tick --- */

  _tick(dt) {
    if (!this.active) return;
    // la visite audio et l'éditeur priment ; le menu met en pause
    if (this.app.audioTour?.active || this.app.editor?.enabled) return this.arreter();
    if (this.app.visitMenu?.open || this._phase === 'porte') return;

    if (this._phase === 'idle') {
      const etape = this._prochaine();
      if (!etape) return;
      this._de.pos.copy(this.app.camera.position);
      this._de.target.copy(this.app.controls.orbit.target);
      this._vers.pos.copy(etape.pos);
      this._vers.target.copy(etape.target);
      const dist = this._de.pos.distanceTo(this._vers.pos);
      this._duree = this.app.quality.reducedMotion
        ? 0.4
        : Math.min(8, Math.max(1.4, dist / VITESSE));
      this._t = 0;
      this._attente = etape.pause;
      this._puis = etape.puis;
      this._phase = 'vol';
      return;
    }

    if (this._phase === 'vol') {
      this._t = Math.min(1, this._t + dt / this._duree);
      const k = easeInOutCubic(this._t);
      this.app.camera.position.lerpVectors(this._de.pos, this._vers.pos, k);
      this.app.controls.orbit.target.lerpVectors(this._de.target, this._vers.target, k);
      if (this._t >= 1) {
        if (this._puis) {
          const suite = this._puis;
          this._puis = null;
          suite();
        } else {
          this._phase = 'pause';
        }
      }
      return;
    }

    if (this._phase === 'pause') {
      this._attente -= dt;
      if (this._attente <= 0) this._phase = 'idle';
    }
  }

  dispose() {
    this.arreter();
    this._off?.();
    window.removeEventListener('pointerdown', this._stopPointeur, true);
    window.removeEventListener('wheel', this._stopPointeur);
    window.removeEventListener('keydown', this._stopTouche, true);
    this._bouton.remove();
  }
}

export function mountDerive(app) {
  if (!app.derive) app.derive = new Derive(app);
  return app.derive;
}
