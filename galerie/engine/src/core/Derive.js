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
const EYE = 2.2;         // hauteur des yeux (même valeur que Controls)

// rayon de sol, réutilisé : on ne crée pas un objet par atterrissage
const _rayon = new THREE.Raycaster();
const _origine = new THREE.Vector3();
const _bas = new THREE.Vector3(0, -1, 0);

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
    app.jetons?.onChange(() => this._peindre());

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

  /** Les œuvres qui restent à débloquer (non découvertes). */
  get inconnues() {
    const prog = this.app.progression;
    return prog ? prog.parcours.filter((a) => !prog.estDecouverte(a)) : [];
  }

  _peindre() {
    const n = this.parcours.length;
    const jetons = this.app.jetons?.compte ?? 0;
    const resteInconnues = this.inconnues.length > 0;
    this._lecture.textContent = this.active
      ? `❚❚ ${t('derive.stop')}` : `▸ ${t('derive.start')}`;
    this._lecture.setAttribute('aria-pressed', String(this.active));
    // Rien à rejouer NI à débloquer : le bouton le dit plutôt que de
    // lancer une visite vide — le pointeur, lui, montre où chercher.
    const vide = n === 0 && (jetons === 0 || !resteInconnues);
    this._lecture.disabled = vide;
    this._lecture.title = vide ? t('derive.empty') : t('derive.title', { n });
    // les flèches paraissent DÈS que la visite est active : ▸ est aussi la
    // porte vers une œuvre non découverte (contre un jeton ◈)
    for (const b of [this._prec, this._suiv]) b.hidden = !this.active;
    this._prec.setAttribute('aria-label', t('derive.prev'));
    // ▸ affiche son PRIX quand le prochain pas est un déblocage : pas de
    // boîte de dialogue — on voit ce qu'on dépense avant de cliquer
    const prochainEstInconnue = this.active && resteInconnues
      && (n === 0 || this._i >= n - 1);
    if (prochainEstInconnue) {
      this._suiv.textContent = '▸ ◈';
      this._suiv.disabled = jetons === 0;
      this._suiv.title = jetons === 0
        ? t('derive.needToken') : t('derive.unlock', { n: jetons });
      this._suiv.setAttribute('aria-label', this._suiv.title);
    } else {
      this._suiv.textContent = '▸';
      this._suiv.disabled = false;
      this._suiv.title = '';
      this._suiv.setAttribute('aria-label', t('derive.next'));
    }
    this._barre.classList.toggle('en-cours', this.active);
  }

  /* ---------------------------------------------------------- marche --- */

  demarrer() {
    if (this.active) return;
    const n = this.parcours.length;
    if (n === 0 && !((this.app.jetons?.compte ?? 0) > 0 && this.inconnues.length)) return;
    this.active = true;
    this._chute = null;                   // une descente en cours s'annule
    this.app.activeFocus?.release?.();
    this.app.controls.locked = true;      // la caméra appartient à la dérive
    // La visite suit l'ORDRE du catalogue, du premier au dernier. Partir de
    // l'œuvre la plus proche semblait malin, mais on tombait au milieu du
    // fil (« pourquoi la n° 4 d'abord ? ») : une visite guidée commence au
    // commencement, et les flèches servent à sauter.
    this._i = 0;
    this._phase = 'idle';
    // rien de découvert mais un jeton en poche : la visite S'OUVRE sur un
    // déblocage — c'est tout l'intérêt du jeton
    if (n === 0) this._versInconnue();
    this._peindre();
  }

  /**
   * Dépense un jeton ◈ et vole vers la PROCHAINE œuvre non découverte du
   * catalogue. Elle est marquée découverte à l'arrivée (elle a été payée) :
   * elle prend son nom au catalogue et son rang dans le parcours.
   */
  _versInconnue() {
    const cibles = this.inconnues;
    if (!cibles.length || !this.app.jetons?.depenser(1)) return false;
    // La PROCHAINE du catalogue, pas la plus proche : la galerie a un
    // ordre, le catalogue l'affiche (n° 1, 2, 3…) et le jeton le suit —
    // sans quoi l'on débloquait la n° 6 sans rien connaître des cinq
    // premières, et les numéros ne voulaient plus rien dire.
    this._deblocage = cibles[0];
    this._phase = 'idle';
    return true;
  }

  arreter() {
    if (!this.active) return;
    this.active = false;
    this._phase = 'idle';
    this._peindre();
    // On ne rend pas la main EN L'AIR. Certaines œuvres se contemplent en
    // vol — le tore flotte au centre du cube de 80 m — et le visiteur qui
    // reprenait la main là-haut restait suspendu, marchant dans le vide :
    // la visite se terminait par un bug. On le repose d'abord au sol.
    if (!this._poser()) {
      this.app.controls.locked = false;
      this.app.controls.resyncCollision?.();
    }
  }

  /**
   * Descente douce jusqu'au sol sous les pieds. Renvoie false s'il n'y a
   * rien à descendre (on était déjà posé) — l'appelant rend alors la main
   * tout de suite. La caméra reste verrouillée le temps du vol plané.
   */
  _poser() {
    const app = this.app;
    const sol = this._solSous(app.camera.position);
    if (sol === null) return false;
    const cible = sol + EYE;
    const chute = app.camera.position.y - cible;
    if (chute < 0.6) return false;          // déjà à hauteur d'homme
    this._chute = {
      de: app.camera.position.clone(),
      cible,
      // la cible du regard descend d'autant : l'assiette est préservée,
      // on se pose sans piquer du nez
      cibleRegard: app.controls.orbit.target.clone(),
      t: 0,
      duree: app.quality.reducedMotion ? 0.25 : Math.min(2.2, 0.5 + chute / 30)
    };
    return true;
  }

  /** Hauteur du sol foulable sous un point, ou null s'il n'y en a pas. */
  _solSous(point) {
    const cibles = this.app.rooms?.walkables?.() ?? [];
    if (!cibles.length) return null;
    _rayon.set(_origine.copy(point).setY(point.y + 0.2), _bas);
    _rayon.far = 400;                       // un cube de 80 m se traverse
    const touche = _rayon.intersectObjects(cibles, true);
    return touche.length ? touche[0].point.y : null;
  }

  suivante() {
    this._aller(+1);
  }

  precedente() {
    this._aller(-1);
  }

  _aller(pas) {
    if (!this.active) { this.demarrer(); return; }
    const n = this.parcours.length;
    // au bout du connu, ▸ propose l'inconnu — contre un jeton
    if (pas > 0 && (n === 0 || this._i >= n - 1) && this.inconnues.length) {
      if (this._versInconnue()) { this._peindre(); return; }
      if (n === 0) return;   // pas de jeton, rien de découvert : sur place
    }
    if (n === 0) return;
    this._i = ((this._i + pas) % n + n) % n;
    this._deblocage = null;
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
    // La descente survit à l'arrêt de la visite : c'est elle qui repose le
    // visiteur avant de lui rendre les commandes.
    if (this._chute) {
      const c = this._chute;
      c.t = Math.min(1, c.t + dt / c.duree);
      const k = easeInOutCubic(c.t);
      const cam = this.app.camera;
      const y = c.de.y + (c.cible - c.de.y) * k;
      const dy = y - cam.position.y;
      cam.position.y = y;
      this.app.controls.orbit.target.y += dy; // l'assiette du regard suit
      if (c.t >= 1) {
        this._chute = null;
        this.app.controls.locked = false;
        this.app.controls.resyncCollision?.();
      }
      return;
    }
    if (!this.active) return;
    // la visite audio et l'éditeur priment ; le menu met en pause
    if (this.app.audioTour?.active || this.app.editor?.enabled) return this.arreter();
    if (this.app.visitMenu?.open || this._phase === 'saut') return;

    const liste = this.parcours;
    // une œuvre payée d'un jeton prime sur le fil du parcours
    const cible = this._deblocage ?? liste[Math.min(this._i, liste.length - 1)];
    if (!cible) return this.arreter();

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
      if (this._t >= 1) {
        this._phase = 'pause';
        // l'œuvre débloquée est DÉCOUVERTE à l'arrivée (elle a été payée) :
        // elle prend son nom, et le fil du parcours se cale sur elle
        if (this._deblocage) {
          this.app.progression?.marquer(this._deblocage);
          this._i = Math.max(0, this.parcours.indexOf(this._deblocage));
          this._deblocage = null;
          this._peindre();
        }
      }
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
