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

  /**
   * La barre, et les deux BORDS.
   *
   * Le bouton de lecture reste au centre, en bas, avec les autres commandes.
   * Les deux flèches, elles, ne sont plus des pastilles collées à lui : ce
   * sont les bords gauche et droit de l'écran, sur toute la hauteur. Deux
   * raisons, et la première suffit : côte à côte, à cinq millimètres l'une
   * de l'autre, rien ne disait laquelle reculait et laquelle avançait — on
   * lisait deux petits triangles, pas une direction. Aux bords, la direction
   * EST la position : on va vers la gauche en poussant le bord gauche.
   *
   * La seconde raison est la main : c'est la zone que le pouce atteint sans
   * regarder, sur un téléphone comme sur un portable.
   */
  _construireBarre() {
    const barre = document.createElement('div');
    barre.id = 'derive-barre';

    const bord = (id, action) => {
      const b = document.createElement('button');
      b.id = id;
      b.className = 'derive-bord';
      b.type = 'button';
      b.hidden = true;
      // UN CHEVRON DESSINÉ, pas un caractère. Un glyphe ne s'étire pas :
      // grossir « ‹ » donne un trait épais au milieu d'un grand vide, et le
      // forcer au scaleY épaissit le trait autant que la flèche. Le tracé
      // SVG, lui, se déforme exactement à la boîte (`preserveAspectRatio`
      // désactivé) pendant que le trait garde son épaisseur
      // (`non-scaling-stroke`) : une flèche haute comme l'écran, fine comme
      // au premier jour.
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'derive-chevron');
      svg.setAttribute('viewBox', '0 0 100 260');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      // …et le trait S'ÉTEINT vers ses deux bouts. Une flèche qui tiendrait
      // vraiment les huit cents pixels de haut ne ferait plus d'angle du
      // tout — cent pixels de large contre huit cents, c'est une ligne, pas
      // une pointe. La BANDE tient donc toute la hauteur (c'est elle qu'on
      // pousse, et le pouce la trouve les yeux fermés) ; la flèche, elle,
      // reste haute — un bon quart de l'écran — mais garde assez d'angle
      // pour se lire d'un coup d'œil, et s'évanouit vers ses extrémités.
      const defs = document.createElementNS(NS, 'defs');
      const grad = document.createElementNS(NS, 'linearGradient');
      const idGrad = `${id}-fondu`;
      grad.setAttribute('id', idGrad);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      for (const [offset, opacite] of [['0', '0'], ['0.35', '0.55'],
        ['0.5', '1'], ['0.65', '0.55'], ['1', '0']]) {
        const stop = document.createElementNS(NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', 'currentColor');
        stop.setAttribute('stop-opacity', opacite);
        grad.appendChild(stop);
      }
      defs.appendChild(grad);
      svg.appendChild(defs);
      const trait = document.createElementNS(NS, 'path');
      trait.setAttribute('d', 'M86 6 L16 130 L86 254');
      trait.setAttribute('fill', 'none');
      trait.setAttribute('stroke', `url(#${idGrad})`);
      trait.setAttribute('stroke-width', '5');
      trait.setAttribute('stroke-linecap', 'round');
      trait.setAttribute('stroke-linejoin', 'round');
      trait.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(trait);
      const prix = document.createElement('span');
      prix.className = 'derive-prix';
      prix.hidden = true;
      b.append(svg, prix);
      b.addEventListener('click', action);
      document.body.appendChild(b);
      b._prix = prix;
      return b;
    };
    const prec = bord('derive-prec', () => this.precedente());
    const suiv = bord('derive-suiv', () => this.suivante());

    const lecture = document.createElement('button');
    lecture.id = 'derive-btn';
    lecture.type = 'button';
    lecture.setAttribute('aria-pressed', 'false');
    lecture.addEventListener('click', () => (this.active ? this.arreter() : this.demarrer()));

    barre.append(lecture);
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
      // le prix s'affiche SOUS le chevron, pas à la place : la flèche reste
      // une flèche, et l'on voit ce qu'on dépense avant de la pousser
      this._suiv._prix.textContent = '◈';
      this._suiv._prix.hidden = false;
      this._suiv.disabled = jetons === 0;
      this._suiv.title = jetons === 0
        ? t('derive.needToken') : t('derive.unlock', { n: jetons });
      this._suiv.setAttribute('aria-label', this._suiv.title);
    } else {
      this._suiv._prix.hidden = true;
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
    this._aRendre = false;                // une remise des commandes en attente
    this.app.activeFocus?.release?.();
    this.app.controls.locked = true;      // la caméra appartient à la dérive
    // un vol plané en cours s'efface : c'est la visite qui porte, désormais
    this.app.controls.resyncCollision?.();
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
    // On rend la main LÀ OÙ L'ON EST, en l'air s'il le faut. Le tore de
    // « Gravité » flotte au centre du belvédère : y reposer le visiteur au
    // sol, c'était lui retirer la vue qu'il venait de gagner — « je devrais
    // y rester ». `Controls.planer()` le laisse donc suspendu ; il vole au
    // regard et se pose de lui-même dès qu'un sol repasse à portée de pas.
    //
    // Mais sans se précipiter : le geste qui arrête la visite est le plus
    // souvent un CLIC SUR L'ŒUVRE qu'on vient d'atteindre. Le travelling
    // d'approche tire la même caméra ; on attend sa fin, sinon les deux se
    // marchent dessus (voir `_tick`).
    this._aRendre = true;
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
    // Remise des commandes en attente : elle patiente tant qu'une œuvre
    // tient la main (approche, fiche ouverte, recul en cours). Le visiteur
    // reste en l'air aussi longtemps qu'il contemple — c'est là-haut que
    // l'œuvre se regarde — et la main lui revient au moment où il est
    // vraiment libre de bouger, à l'altitude où la visite l'a laissé.
    if (this._aRendre) {
      if (this.app.activeFocus) return;
      this._aRendre = false;
      this.app.controls.planer();
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
