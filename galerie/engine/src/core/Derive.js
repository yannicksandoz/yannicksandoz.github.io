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

    // LE JETON, EN UN BOUTON. Dépenser un ◈ demandait jusqu'ici de lancer
    // la visite, d'aller au bout du fil, et de reconnaître un petit losange
    // sous un chevron. C'est beaucoup de conditions pour un geste qui tient
    // en une phrase : « voir une œuvre inconnue, un jeton ». Un rond, le
    // symbole, et la phrase en info-bulle.
    const jeton = document.createElement('button');
    jeton.id = 'derive-jeton';
    jeton.type = 'button';
    const glyphe = document.createElement('span');
    glyphe.className = 'derive-jeton-glyphe';
    glyphe.textContent = '◈';
    glyphe.setAttribute('aria-hidden', 'true');
    // …et la PHRASE, au-dessus, dès qu'on le vise. Une info-bulle ne se
    // découvre qu'au survol d'un pointeur ; ici le mot paraît aussi au
    // clavier, et sur un écran tactile au moment du contact.
    const mot = document.createElement('span');
    mot.className = 'derive-jeton-mot';
    jeton.append(glyphe, mot);
    jeton._mot = mot;
    jeton.addEventListener('click', () => this.ouvrirInconnue());

    barre.append(lecture, jeton);
    document.body.appendChild(barre);
    this._prec = prec;
    this._lecture = lecture;
    this._jeton = jeton;
    this._suiv = suiv;
    // la barre AVANT de peindre : _peindre la consulte, et une exception
    // ici laisserait la dérive à moitié construite (bouton figé sur
    // « désactivé », plus aucun rafraîchissement)
    this._barre = barre;
    this._peindre();
    onLangChange(() => this._peindre());
    return barre;
  }

  /**
   * LE FIL : TOUTES les œuvres, dans l'ordre de la galerie — pas seulement
   * celles qu'on a trouvées.
   *
   * La dérive parcourait la liste des œuvres DÉCOUVERTES, et le jeton
   * débloquait « la première inconnue de la galerie ». Deux ordres
   * différents, donc, et le résultat sautait : on visitait la 3, la 7, la
   * 9, puis le jeton ramenait à la 4 — et comme la nouvelle venue
   * s'insérait à son rang dans la liste des découvertes, le curseur
   * désignait soudain une autre œuvre. C'est le « drôle d'ordre » de
   * l'auteur, et le « on n'utilise pas les jetons à la suite ».
   *
   * Un seul ordre, désormais, celui du catalogue, et il ne bouge jamais :
   * chaque pas va au rang suivant. S'il est connu, on y vole ; s'il est
   * inconnu, il coûte un jeton — et la flèche le dit AVANT qu'on la
   * pousse. Sans jeton, le pas saute jusqu'au prochain rang connu : la
   * visite ne se bloque pas, elle passe.
   */
  get parcours() {
    return this.app.progression?.parcours ?? [];
  }

  /** Les œuvres indexées — ce que la visite peut montrer sans rien payer. */
  get connues() {
    return this.app.progression?.indexees ?? [];
  }

  /** Les œuvres qui restent à débloquer (non découvertes). */
  get inconnues() {
    const prog = this.app.progression;
    return prog ? prog.parcours.filter((a) => !prog.estDecouverte(a)) : [];
  }

  _estConnue(a) {
    return Boolean(a) && Boolean(this.app.progression?.estDecouverte(a));
  }

  /**
   * Le RANG que viserait un pas de `pas` depuis la position courante, et ce
   * qu'il en coûte. `paye: true` veut dire « ce rang est inconnu, il faudra
   * un jeton » ; sans jeton en poche on saute au prochain rang connu.
   */
  _prochainPas(pas = +1) {
    const liste = this.parcours;
    const n = liste.length;
    if (!n) return null;
    const voisin = ((this._i + pas) % n + n) % n;
    if (this._estConnue(liste[voisin])) return { rang: voisin, paye: false };
    const jetons = this.app.jetons?.compte ?? 0;
    if (jetons > 0) return { rang: voisin, paye: true };
    // pas de jeton : on cherche le prochain rang CONNU dans le même sens
    for (let k = 2; k <= n; k++) {
      const r = ((this._i + pas * k) % n + n) % n;
      if (this._estConnue(liste[r])) return { rang: r, paye: false };
    }
    return null;                       // rien de connu : la visite est vide
  }

  _peindre() {
    const connues = this.connues.length;
    const jetons = this.app.jetons?.compte ?? 0;
    const resteInconnues = this.inconnues.length > 0;
    this._lecture.textContent = this.active
      ? `❚❚ ${t('derive.stop')}` : `▸ ${t('derive.start')}`;
    this._lecture.setAttribute('aria-pressed', String(this.active));
    // Rien à rejouer NI à débloquer : le bouton le dit plutôt que de
    // lancer une visite vide — le pointeur, lui, montre où chercher.
    const vide = connues === 0 && (jetons === 0 || !resteInconnues);
    this._lecture.disabled = vide;
    this._lecture.title = vide
      ? t('derive.empty') : t('derive.title', { n: connues });

    // LE BOUTON ROND ◈ : ouvrir une œuvre inconnue, tout de suite, sans
    // passer par la flèche ni attendre la fin du fil. Il dit son prix en
    // toutes lettres — un jeton — et s'éteint quand il n'y a plus rien à
    // ouvrir ou plus de quoi payer.
    const peutOuvrir = resteInconnues && jetons > 0;
    this._jeton.disabled = !peutOuvrir;
    this._jeton.title = !resteInconnues ? t('derive.revealNone')
      : (jetons === 0 ? t('derive.needToken') : t('derive.reveal', { n: jetons }));
    this._jeton.setAttribute('aria-label', this._jeton.title);
    this._jeton._mot.textContent = this._jeton.title;

    // les flèches paraissent DÈS que la visite est active : ▸ est aussi la
    // porte vers une œuvre non découverte (contre un jeton ◈)
    for (const b of [this._prec, this._suiv]) b.hidden = !this.active;
    this._prec.setAttribute('aria-label', t('derive.prev'));
    // ▸ DIT SON PRIX à chaque pas, pas seulement au bout du fil : le rang
    // suivant est-il une œuvre qu'on n'a pas encore trouvée ? Alors le
    // pas coûte un jeton, et le ◈ paraît sous le chevron — pas de boîte
    // de dialogue, on voit ce qu'on dépense avant de pousser.
    const liste = this.parcours;
    const voisin = liste.length
      ? liste[((this._i + 1) % liste.length + liste.length) % liste.length] : null;
    const inconnuDevant = this.active && Boolean(voisin) && !this._estConnue(voisin);
    if (inconnuDevant) {
      this._suiv._prix.textContent = '◈';
      this._suiv._prix.hidden = false;
      // sans jeton, la flèche SAUTE au prochain rang connu : elle reste
      // active, et le ◈ s'éteint pour dire qu'il n'achètera rien
      this._suiv._prix.classList.toggle('sans-jeton', jetons === 0);
      this._suiv.title = jetons === 0
        ? t('derive.needToken') : t('derive.unlock', { n: jetons });
      this._suiv.setAttribute('aria-label', this._suiv.title);
    } else {
      this._suiv._prix.hidden = true;
      this._suiv.title = '';
      this._suiv.setAttribute('aria-label', t('derive.next'));
    }
    this._suiv.disabled = false;
    this._barre.classList.toggle('en-cours', this.active);
    // L'état de la dérive intéresse d'autres coins de l'interface (le
    // bouton de la toolbox) sans qu'ils aient à connaître ce module :
    // un événement du document suffit, chacun s'y abonne s'il veut.
    document.dispatchEvent(new CustomEvent('galerie:derive', {
      detail: { active: this.active }
    }));
  }

  /* ---------------------------------------------------------- marche --- */

  demarrer() {
    if (this.active) return;
    const connues = this.connues.length;
    if (connues === 0
      && !((this.app.jetons?.compte ?? 0) > 0 && this.inconnues.length)) return;
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
    const liste = this.parcours;
    const premier = liste.findIndex((a) => this._estConnue(a));
    this._i = premier >= 0 ? premier : 0;
    this._phase = 'idle';
    // rien de découvert mais un jeton en poche : la visite S'OUVRE sur un
    // déblocage — c'est tout l'intérêt du jeton
    if (connues === 0) this._versInconnue(0);
    this._peindre();
  }

  /**
   * Dépense un jeton ◈ pour l'œuvre inconnue du RANG `rang` (par défaut la
   * première inconnue qui suit la position courante). Elle est marquée
   * découverte à l'arrivée — elle a été payée : elle prend alors son nom au
   * catalogue, et le fil se cale sur elle.
   */
  _versInconnue(rang = null) {
    const liste = this.parcours;
    if (!liste.length) return false;
    let cible = null;
    if (rang !== null && liste[rang] && !this._estConnue(liste[rang])) {
      cible = liste[rang];
    } else {
      // LA PROCHAINE INCONNUE APRÈS SOI, pas la première de la galerie :
      // le jeton doit avancer le fil, jamais le faire revenir en arrière.
      // C'est là qu'il se dépensait « pas à la suite » — on visitait la 3,
      // la 7, la 9, et le ◈ ramenait à la 4.
      const n = liste.length;
      const depart = liste.length ? this._i : 0;
      for (let k = 1; k <= n; k++) {
        const a = liste[(depart + k) % n];
        if (!this._estConnue(a)) { cible = a; break; }
      }
    }
    if (!cible || !this.app.jetons?.depenser(1)) return false;
    this._deblocage = cible;
    this._phase = 'idle';
    return true;
  }

  /**
   * Le bouton rond ◈ : ouvrir une œuvre inconnue tout de suite. Lance la
   * visite si elle dort — sans quoi le jeton serait dépensé pour une
   * caméra qui ne bouge pas.
   */
  ouvrirInconnue() {
    if (!this.inconnues.length || (this.app.jetons?.compte ?? 0) === 0) return false;
    if (!this.active) {
      this.active = true;
      this._aRendre = false;
      this.app.activeFocus?.release?.();
      this.app.controls.locked = true;
      this.app.controls.resyncCollision?.();
      const liste = this.parcours;
      const premier = liste.findIndex((a) => this._estConnue(a));
      this._i = premier >= 0 ? premier : 0;
    }
    const ok = this._versInconnue();
    this._peindre();
    return ok;
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

  /**
   * UN PAS SUR LE FIL, dans l'ordre du catalogue.
   *
   * Le rang voisin est-il connu ? on y vole. Inconnu ? il coûte un jeton,
   * et `_prochainPas` l'a déjà dit à la flèche. Sans jeton, on saute au
   * prochain rang connu du même côté : la visite ne bute jamais sur une
   * porte fermée, elle passe devant.
   */
  _aller(pas) {
    if (!this.active) { this.demarrer(); return; }
    const cap = this._prochainPas(pas);
    if (!cap) return;                       // rien de connu, rien à payer
    if (cap.paye) {
      if (this._versInconnue(cap.rang)) { this._peindre(); return; }
      return;                               // le jeton a filé entre-temps
    }
    this._i = cap.rang;
    this._deblocage = null;
    this._phase = 'idle';   // la prochaine frame prépare le vol
    this._peindre();
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
    // Le fil porte TOUTES les œuvres : on ne s'arrête que sur celles qu'on
    // connaît, ou sur celle qu'un jeton vient d'ouvrir. Une inconnue non
    // payée sous le curseur (la mémoire a changé sous nos pieds) ne se
    // montre pas — on passe à la suivante.
    let cible = this._deblocage ?? liste[Math.min(this._i, liste.length - 1)];
    if (!this._deblocage && cible && !this._estConnue(cible)) {
      const cap = this._prochainPas(+1);
      if (!cap || cap.paye) return this.arreter();
      this._i = cap.rang;
      cible = liste[this._i];
    }
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
