import * as THREE from 'three';

/**
 * Le POINTEUR : il montre toujours la prochaine chose à découvrir.
 *
 * Deux formes, selon l'endroit où se trouve la cible :
 *   — hors du champ, une flèche glisse le long du bord de l'écran et
 *     désigne la direction à prendre ;
 *   — DANS le champ, un repère se pose juste au-dessus d'elle. Sans lui,
 *     le pointeur disparaissait dès qu'on tournait la tête vers le bon
 *     endroit — juste au moment où il fallait confirmer « c'est ça ».
 *
 * Ce qu'il désigne se décide sur le PLAN DE LA GALERIE, pas sur la seule
 * pièce courante : l'œuvre non découverte la plus proche est cherchée de
 * proche en proche à travers les portails (parcours en largeur), et le
 * pointeur vise alors la porte qui mène vers elle. Sans ce calcul, deux
 * pièces sans œuvre se renvoyaient l'une à l'autre — l'entrée montrait le
 * jardin, le jardin renvoyait à l'entrée, et le visiteur tournait en rond.
 *
 * Décoratif et silencieux : aria-hidden, aucun focus, aucun texte.
 */
const MARGE = 44;        // distance au bord, en px

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

    this._v = new THREE.Vector3();
    this._route = { cle: '', cible: null, t: -1 };
    this._off = app.onUpdate((dt) => this._tick(dt));
  }

  /* ------------------------------------------------------------ cible --- */

  /** Pièces voisines d'une pièce, par portail. */
  _voisines(room) {
    return (room.config.portals ?? [])
      .map((p) => this.app.rooms.rooms.get(p.to))
      .filter(Boolean);
  }

  /**
   * L'objet à viser : la PROCHAINE œuvre du catalogue si elle est ici,
   * sinon le PORTAIL qui engage le chemin vers sa pièce. Le trajet est
   * recalculé rarement (le graphe ne bouge pas d'une frame à l'autre)
   * mais toujours quand la cible change.
   */
  _cible() {
    const rooms = this.app.rooms;
    const prog = this.app.progression;
    if (!rooms?.current || !prog) return null;
    const room = rooms.current;

    // La galerie a un ORDRE, et le catalogue l'affiche : n° 1, 2, 3… Le
    // pointeur suit ce fil — il montre la PROCHAINE à découvrir, pas la
    // plus proche. Sans quoi l'on tombait sur la n° 6 en n'ayant rien vu
    // du reste, et les numéros du catalogue ne voulaient plus rien dire.
    const prochaine = prog.parcours.find((a) => !prog.estDecouverte(a));
    if (!prochaine) return null;                  // galerie épuisée
    // ici même : on la montre ; ailleurs : on montre la porte qui y mène
    if (prochaine.room === room) return prochaine.group;

    const cle = `${room.config.id}|${prochaine.config.id}`;
    if (this._route.cle !== cle) {
      this._route = { cle, cible: this._porteVers(room, prochaine) };
    }
    return this._route.cible;
  }

  /**
   * Portail de `room` qui engage le chemin le plus court vers la pièce de
   * `cible` (parcours en largeur du graphe des pièces). Renvoie null si
   * elle est injoignable — le pointeur se tait alors plutôt que de
   * désigner une porte au hasard.
   */
  _porteVers(room, cible) {
    const rooms = this.app.rooms;
    const vues = new Set([room.config.id]);
    // file : [pièce, premier portail emprunté depuis la pièce courante]
    const file = [];
    for (const p of room.config.portals ?? []) {
      const suivante = rooms.rooms.get(p.to);
      if (!suivante || vues.has(suivante.config.id)) continue;
      vues.add(suivante.config.id);
      file.push([suivante, p.to]);
    }
    const salleCible = cible?.room?.config.id;
    while (file.length) {
      const [salle, premier] = file.shift();
      if (salle.config.id === salleCible) {
        // la porte de CETTE pièce qui engage ce chemin
        const mesh = (room.portalMeshes ?? []).find(
          (m) => (m.userData.portal?.cfg?.to ?? m.userData.portal?.to) === premier);
        if (mesh) return mesh;
      }
      for (const voisine of this._voisines(salle)) {
        if (vues.has(voisine.config.id)) continue;
        vues.add(voisine.config.id);
        file.push([voisine, premier]);
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- tick --- */

  _tick(_dt) {
    const cache = () => { this.el.style.opacity = '0'; };
    if (this.app.audioTour?.active || this.app.editor?.enabled
      || this.app.activeFocus || this.app.derive?.active
      || this.app.visitMenu?.open) return cache();
    const cible = this._cible();
    if (!cible) return cache();

    cible.getWorldPosition(this._v);
    // le repère se pose AU-DESSUS de la cible, pas dessus : on veut voir
    // ce qu'il désigne
    this._v.y += 1.9;
    this._v.project(this.app.camera);
    const devant = this._v.z < 1;
    const dansLeChamp = devant
      && Math.abs(this._v.x) < 0.92 && Math.abs(this._v.y) < 0.92;

    const w = window.innerWidth, h = window.innerHeight;
    if (dansLeChamp) {
      // — en vue : un repère posé au-dessus, pointe en bas
      const x = (this._v.x + 1) / 2 * w;
      const y = (1 - this._v.y) / 2 * h;
      this.el.style.transform =
        `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%) rotate(180deg)`;
      this.el.style.opacity = '0.75';
      return;
    }

    // — hors champ : une flèche au bord, dans la direction à prendre
    let dx = this._v.x, dy = this._v.y;
    if (!devant) { dx = -dx; dy = -dy; }
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
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
