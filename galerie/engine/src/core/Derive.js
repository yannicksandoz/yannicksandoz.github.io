import * as THREE from 'three';
import { t, onLangChange } from './i18n.js';
import { easeInOutCubic } from './utils.js';
import { pointDeVue } from './Progression.js';

/**
 * « Laisse-toi porter » — la visite guidée des œuvres DÉCOUVERTES.
 *
 * Le parcours n'explore plus : il rejoue. La galerie se découvre à pied,
 * en suivant le pointeur ; ce que l'on a trouvé entre au catalogue, et
 * c'est ce catalogue que la dérive parcourt, dans l'ordre des salles. La
 * caméra vole d'une œuvre à l'autre, se pose devant chacune le temps
 * d'écouter, puis repart — et l'on garde la main sur le fil :
 *
 *   ◂ / ▸  (boutons, ou flèches gauche/droite du clavier) : l'œuvre
 *          précédente, la suivante — sans attendre la fin de la pause ;
 *   tout autre geste : la dérive s'efface, la marche revient.
 *
 * Les changements de pièce se font par fondu (pas par les portails) : le
 * chemin n'a pas d'importance ici, seule compte l'œuvre suivante.
 *
 * prefers-reduced-motion : pas de long travelling — le vol devient un
 * déplacement quasi instantané, les pauses font le rythme.
 */

const PAUSE = 8;         // secondes devant chaque œuvre
const VITESSE = 4.5;     // m/s de croisière

export class Derive {
  constructor(app) {
    this.app = app;
    this.active = false;
    this._phase = 'idle';   // idle | vol | pause | saut
    this._i = 0;            // rang dans le parcours
    this._t = 0;
    this._duree = 1;
    this._attente = 0;
    this._de = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._vers = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

    this._barre = this._construireBarre();
    this._off = app.onUpdate((dt) => this._tick(dt));
    app.progression?.onChange(() => this._peindre());

    // La main revient au moindre geste — sauf les flèches, qui NAVIGUENT,
    // et les clics sur les boutons, qui pilotent.
    this._stopPointeur = (e) => {
      if (!this.active) return;
      if (e.target instanceof Element
        && e.target.closest('button, a, input, #visit-menu, #progress-list')) return;
      this.arreter();
    };
    this._stopTouche = (e) => {
      if (!this.active) return;
      if (e.target instanceof Element
        && e.target.closest('input, textarea, select, #visit-menu')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.precedente(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.suivante(); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target instanceof Element && e.target.closest('button, a')) return;
      }
      this.arreter();
    };
    window.addEventListener('pointerdown', this._stopPointeur, true);
    window.addEventListener('wheel', this._stopPointeur, { passive: true });
    window.addEventListener('keydown', this._stopTouche, true);
  }

  /* --------------------------------------------------------- surface --- */

  _construireBarre() {
    const barre = document.createElement('div');
    barre.id = 'derive-barre';

    const prec = document.createElement('button');
    prec.id = 'derive-prec';
    prec.type = 'button';
    prec.textContent = '◂';
    prec.addEventListener('click', () => this.precedente());

    const lecture = document.createElement('button');
    lecture.id = 'derive-btn';
    lecture.type = 'button';
    lecture.setAttribute('aria-pressed', 'false');
    lecture.addEventListener('click', () => (this.active ? this.arreter() : this.demarrer()));

    const suiv = document.createElement('button');
    suiv.id = 'derive-suiv';
    suiv.type = 'button';
    suiv.textContent = '▸';
    suiv.addEventListener('click', () => this.suivante());

    barre.append(prec, lecture, suiv);
    document.body.appendChild(barre);
    this._prec = prec;
    this._lecture = lecture;
    this._suiv = suiv;
    // la barre AVANT de peindre : _peindre la consulte, et une exception
    // ici laisserait la dérive à moitié construite (bouton figé sur
    // « désactivé », plus aucun rafraîchissement)
    this._barre = barre;
    this._peindre();
    onLangChange(() => this._peindre());
    return barre;
  }

  /** Le parcours du jour : les œuvres indexées, dans l'ordre des salles. */
  get parcours() {
    return this.app.progression?.indexees ?? [];
  }

  _peindre() {
    const n = this.parcours.length;
    this._lecture.textContent = this.active
      ? `❚❚ ${t('derive.stop')}` : `▸ ${t('derive.start')}`;
    this._lecture.setAttribute('aria-pressed', String(this.active));
    // Rien de découvert : rien à rejouer. Le bouton le dit plutôt que de
    // lancer une visite vide — et le pointeur, lui, montre où chercher.
    this._lecture.disabled = n === 0;
    this._lecture.title = n === 0 ? t('derive.empty') : t('derive.title', { n });
    for (const b of [this._prec, this._suiv]) {
      b.hidden = !this.active || n < 2;
    }
    this._prec.setAttribute('aria-label', t('derive.prev'));
    this._suiv.setAttribute('aria-label', t('derive.next'));
    this._barre.classList.toggle('en-cours', this.active);
  }

  /* ---------------------------------------------------------- marche --- */

  demarrer() {
    if (this.active || this.parcours.length === 0) return;
    this.active = true;
    this.app.activeFocus?.release?.();
    this.app.controls.locked = true;      // la caméra appartient à la dérive
    // reprendre à l'œuvre la plus proche : la visite commence là où l'on est
    this._i = this._plusProche();
    this._phase = 'idle';
    this._peindre();
  }

  arreter() {
    if (!this.active) return;
    this.active = false;
    this._phase = 'idle';
    this.app.controls.locked = false;
    this.app.controls.resyncCollision?.();
    this._peindre();
  }

  suivante() {
    this._aller(+1);
  }

  precedente() {
    this._aller(-1);
  }

  _aller(pas) {
    const n = this.parcours.length;
    if (n === 0) return;
    if (!this.active) { this.demarrer(); return; }
    this._i = ((this._i + pas) % n + n) % n;
    this._phase = 'idle';   // la prochaine frame prépare le vol
  }

  _plusProche() {
    const liste = this.parcours;
    const cam = this.app.camera.position;
    let best = 0, bd = Infinity;
    liste.forEach((a, i) => {
      const d = a.group.getWorldPosition(new THREE.Vector3()).distanceTo(cam);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /* ------------------------------------------------------------ tick --- */

  _tick(dt) {
    if (!this.active) return;
    // la visite audio et l'éditeur priment ; le menu met en pause
    if (this.app.audioTour?.active || this.app.editor?.enabled) return this.arreter();
    if (this.app.visitMenu?.open || this._phase === 'saut') return;

    const liste = this.parcours;
    if (!liste.length) return this.arreter();
    if (this._i >= liste.length) this._i = 0;
    const cible = liste[this._i];

    if (this._phase === 'idle') {
      // pièce différente : on y passe par un fondu, puis on vole sur place
      const salle = cible.room?.config.id;
      if (salle && this.app.rooms.current?.config.id !== salle) {
        this._phase = 'saut';
        this.app.rooms.setCurrent(salle).then(() => {
          if (this.active) this._phase = 'idle';
        });
        return;
      }
      const vue = pointDeVue(this.app, cible);
      this._de.pos.copy(this.app.camera.position);
      this._de.target.copy(this.app.controls.orbit.target);
      this._vers.pos.copy(vue.pos);
      this._vers.target.copy(vue.cible);
      const dist = this._de.pos.distanceTo(this._vers.pos);
      this._duree = this.app.quality.reducedMotion
        ? 0.4
        : Math.min(6, Math.max(1.2, dist / VITESSE));
      this._t = 0;
      this._attente = PAUSE;
      this._phase = 'vol';
      return;
    }

    if (this._phase === 'vol') {
      this._t = Math.min(1, this._t + dt / this._duree);
      const k = easeInOutCubic(this._t);
      this.app.camera.position.lerpVectors(this._de.pos, this._vers.pos, k);
      this.app.controls.orbit.target.lerpVectors(this._de.target, this._vers.target, k);
      if (this._t >= 1) this._phase = 'pause';
      return;
    }

    if (this._phase === 'pause') {
      this._attente -= dt;
      if (this._attente <= 0) this.suivante();
    }
  }

  dispose() {
    this.arreter();
    this._off?.();
    window.removeEventListener('pointerdown', this._stopPointeur, true);
    window.removeEventListener('wheel', this._stopPointeur);
    window.removeEventListener('keydown', this._stopTouche, true);
    this._barre.remove();
  }
}

export function mountDerive(app) {
  if (!app.derive) app.derive = new Derive(app);
  return app.derive;
}
