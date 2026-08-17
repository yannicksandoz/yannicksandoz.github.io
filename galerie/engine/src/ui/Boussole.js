import * as THREE from 'three';

/**
 * Boussole d'écran : quand l'œuvre non découverte la plus proche est HORS
 * CHAMP, une petite flèche glisse le long du bord de l'écran et pointe vers
 * elle. Quand la pièce n'a plus rien à découvrir, elle pointe le portail le
 * plus proche — la sortie est une direction comme une autre.
 *
 * Décorative et silencieuse : aria-hidden, aucun focus, aucun texte. Elle
 * s'efface dès que la cible entre dans le champ — un guide, pas un HUD.
 */
const MARGE = 44;        // distance au bord, en px
const PERIODE = 0.15;    // secondes entre deux évaluations

export class Boussole {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'boussole';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26">'
      + '<path d="M12 2 L19 20 L12 15.5 L5 20 Z" fill="currentColor"/></svg>';
    this.el.style.opacity = '0';
    document.body.appendChild(this.el);

    this._acc = 0;
    this._v = new THREE.Vector3();
    this._off = app.onUpdate((dt) => this._tick(dt));
  }

  _cible() {
    const rooms = this.app.rooms;
    const prog = this.app.progression;
    if (!rooms?.current || !prog) return null;
    // l'œuvre non découverte la plus proche DE LA PIÈCE COURANTE
    let best = null, bestD = Infinity;
    for (const a of rooms.current.artworks ?? []) {
      if (a.config.role === 'decor' || prog.estDecouverte(a)) continue;
      if (a.distance < bestD) { bestD = a.distance; best = a.group; }
    }
    if (best) return best;
    // pièce épuisée : le portail le plus proche montre la suite
    let mesh = null; bestD = Infinity;
    for (const m of rooms.current.portalMeshes ?? []) {
      const d = m.getWorldPosition(this._v).distanceTo(this.app.camera.position);
      if (d < bestD) { bestD = d; mesh = m; }
    }
    return mesh;
  }

  _tick(dt) {
    this._acc += dt;
    if (this._acc < PERIODE) return;
    this._acc = 0;

    const cache = () => { this.el.style.opacity = '0'; };
    if (this.app.audioTour?.active || this.app.editor?.enabled
      || this.app.activeFocus || this.app.derive?.active
      || this.app.visitMenu?.open) return cache();
    const cible = this._cible();
    if (!cible) return cache();

    cible.getWorldPosition(this._v).project(this.app.camera);
    const devant = this._v.z < 1;
    // dans le champ (avec une petite marge) : la flèche n'a rien à dire
    if (devant && Math.abs(this._v.x) < 0.82 && Math.abs(this._v.y) < 0.82) {
      return cache();
    }

    // hors champ : direction écran (derrière soi, le projeté s'inverse)
    let dx = this._v.x, dy = this._v.y;
    if (!devant) { dx = -dx; dy = -dy; }
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;

    const w = window.innerWidth, h = window.innerHeight;
    // point d'ancrage : le bord de l'écran dans cette direction
    const kx = (w / 2 - MARGE) / Math.abs(dx || 1e-6);
    const ky = (h / 2 - MARGE) / Math.abs(dy || 1e-6);
    const k = Math.min(kx, ky);
    const x = w / 2 + dx * k;
    const y = h / 2 - dy * k;
    const angle = Math.atan2(dx, dy) * 180 / Math.PI;

    this.el.style.transform =
      `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%) rotate(${angle.toFixed(1)}deg)`;
    this.el.style.opacity = '0.55';
  }

  dispose() {
    this._off?.();
    this.el.remove();
  }
}

export function mountBoussole(app) {
  if (!app.boussole) app.boussole = new Boussole(app);
  return app.boussole;
}
