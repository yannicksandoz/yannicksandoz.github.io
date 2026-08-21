/**
 * Carte de la galerie — ce qu'on a vu, et rien de plus.
 *
 * Une carte complète serait une table des matières : on saurait d'avance
 * combien de salles restent, où elles sont, comment elles s'enchaînent — et
 * la galerie cesserait d'être un endroit où l'on se perd. Une carte vide
 * serait inutile. Celle-ci se DESSINE EN MARCHANT :
 *
 *   • une pièce n'apparaît qu'après qu'on y a posé le pied ;
 *   • un trait n'apparaît qu'après qu'on a franchi le passage ;
 *   • une porte vue mais non prise laisse un « ? » — on sait qu'il y a
 *     quelque chose par là, on ne sait pas quoi.
 *
 * Le tracé lui-même vient de `planGalerie` : ni l'auteur ni le contenu ne
 * tiennent de coordonnées de carte, elles se déduisent du graphe des
 * portails. Ici, on ne fait que le montrer.
 *
 * **Accessibilité** — le SVG est décoratif (`aria-hidden`). La vérité
 * accessible est la LISTE des pièces du menu, qui suit exactement la même
 * mémoire : ce que la carte cache, la liste le cache aussi. Un plan qui
 * ménage la surprise à côté d'une liste qui la vend n'aurait ménagé rien.
 */
import * as THREE from 'three';
import { planGalerie } from '../core/planGalerie.js';
import { estFerme } from '../core/Cooldown.js';

const CLE_MINIMAP = 'galerie-minimap';
const MARGE = 14;      // mètres laissés autour du tracé

/**
 * Le plan, calculé une fois par scène : il ne bouge pas d'une pièce à
 * l'autre, et le recalculer à chaque image serait du gaspillage pur.
 *
 * La clé du cache décrit ce dont le tracé dépend — les identifiants, les
 * empreintes, les portails. L'éditeur redimensionne une salle ou en perce
 * une autre sous nos pieds : le plan doit alors se refaire, sans que
 * personne ait à penser à l'invalider.
 */
export function planDe(app) {
  const rooms = [...(app.rooms?.rooms?.values() ?? [])].map((r) => r.config);
  const cle = rooms.map((r) => `${r.id}:${r.shell?.width ?? ''}x${r.shell?.depth ?? ''}`
    + `:${(r.portals ?? []).map((p) => p.to).join('+')}`).join(',');
  if (app._plan?.cle !== cle) {
    app._plan = { cle, plan: planGalerie(rooms, rooms[0]?.id) };
  }
  return app._plan.plan;
}

/**
 * Où se tient le visiteur, en coordonnées de plan, et vers où il regarde.
 * Null hors d'une pièce connue. Le passage par le repère de la pièce est
 * obligatoire : au belvédère, une pièce est basculée, et lire la caméra en
 * coordonnées monde placerait le point n'importe où.
 */
export function position(app) {
  const room = app.rooms?.current;
  if (!room) return null;
  const piece = planDe(app).pieces.find((p) => p.id === room.config.id);
  if (!piece) return null;
  const local = room.group.worldToLocal(_v.copy(app.camera.position));
  app.camera.getWorldDirection(_d);
  const cap = room.group.getWorldQuaternion(_q).invert();
  _d.applyQuaternion(cap);
  return {
    x: piece.x + local.x, z: piece.z + local.z,
    // l'aiguille pointe vers (dx, dz) ; en SVG, un `rotate` va dans le sens
    // des aiguilles depuis le haut de l'écran, d'où l'atan2 inversé
    cap: (Math.atan2(_d.x, -_d.z) * 180) / Math.PI
  };
}

/**
 * Ce que la mémoire autorise à montrer : les pièces vues, les passages
 * pris, et les pièces seulement pressenties (une porte non franchie depuis
 * une pièce vue).
 */
export function vu(app) {
  const plan = planDe(app);
  const m = app.memoire;
  const courante = app.rooms?.current?.config.id;
  const vues = new Set(m ? m.pieces : plan.pieces.map((p) => p.id));
  if (courante) vues.add(courante);
  const pressenties = new Set();
  const liens = [];
  for (const porte of plan.portes) {
    const a = vues.has(porte.a), b = vues.has(porte.b);
    if (a && b && (!m || m.portes.has(porte.cle))) liens.push(porte);
    else if (a !== b) pressenties.add(a ? porte.b : porte.a);
  }
  return {
    plan,
    pieces: plan.pieces.filter((p) => vues.has(p.id)),
    pressenties: plan.pieces.filter((p) => pressenties.has(p.id)),
    liens,
    courante
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Le tracé, en SVG. `noms` écrit les titres, `autour` ne montre que les
 * abords de la pièce courante (la minimap ne cadre pas toute la galerie —
 * on n'y verrait plus où l'on est).
 */
export function dessinerPlan(app, { noms = true, autour = 0, centreSur = null } = {}) {
  const etat = vu(app);
  const ici = position(app);
  let pieces = etat.pieces;
  let pressenties = etat.pressenties;

  if (autour > 0 && ici) {
    // Ce que montre une minimap : où l'on est, et où mènent les portes. Une
    // voisine se garde donc même LOIN du cadre — le trait qui y file dit
    // « c'est par là », et c'est précisément ce qu'on vient y lire. Filtrer
    // sur la seule distance laissait la salle courante seule au milieu.
    const attachee = (id) => etat.plan.portes.some(
      (l) => (l.a === etat.courante && l.b === id) || (l.b === etat.courante && l.a === id));
    const proche = (p) => Math.abs(p.x - ici.x) < autour * 1.6
      && Math.abs(p.z - ici.z) < autour * 1.6;
    const garder = (p) => p.id === etat.courante || attachee(p.id) || proche(p);
    pieces = pieces.filter(garder);
    pressenties = pressenties.filter(garder);
  }
  const vues = new Set(pieces.map((p) => p.id));
  const centre = new Map([...pieces, ...pressenties].map((p) => [p.id, p]));
  const liens = etat.liens.filter((l) => centre.has(l.a) && centre.has(l.b));

  if (!pieces.length) return '';

  // Une porte non franchie : un point d'interrogation posé VERS la pièce
  // inconnue mais tout près de celle qu'on connaît — sa distance réelle est
  // justement ce qu'on ne sait pas encore. On calcule ces points d'abord :
  // c'est de l'encre, et le cadre se règle sur l'encre, pas sur des pièces
  // qu'on ne dessine pas (sinon le tracé flotte au milieu d'un grand vide).
  const inconnues = pressenties.map((p) => {
    const voisin = etat.plan.portes.find(
      (l) => (l.a === p.id && vues.has(l.b)) || (l.b === p.id && vues.has(l.a)));
    const depuis = voisin ? centre.get(voisin.a === p.id ? voisin.b : voisin.a) : null;
    return {
      depuis,
      x: depuis ? depuis.x + (p.x - depuis.x) * 0.42 : p.x,
      z: depuis ? depuis.z + (p.z - depuis.z) * 0.42 : p.z
    };
  });

  // La minimap garde une ÉCHELLE CONSTANTE, cadrée sur LA PIÈCE et non sur
  // le visiteur : un cadre qui s'ajuste au contenu ferait rétrécir la salle
  // à chaque porte découverte, et un cadre qui suit les pas ferait glisser
  // les murs sous une aiguille immobile — c'est l'aiguille qui doit bouger.
  // La grande carte, elle, cadre tout ce qu'on connaît.
  const cadre = autour > 0 ? (centreSur ?? ici) : null;
  const bords = [
    ...pieces.flatMap((p) => [
      { x: p.x - p.w / 2, z: p.z - p.d / 2 }, { x: p.x + p.w / 2, z: p.z + p.d / 2 }]),
    ...inconnues.map((m) => ({ x: m.x, z: m.z }))
  ];
  const x0 = cadre ? cadre.x - autour : Math.min(...bords.map((b) => b.x)) - MARGE;
  const z0 = cadre ? cadre.z - autour : Math.min(...bords.map((b) => b.z)) - MARGE;
  const x1 = cadre ? cadre.x + autour : Math.max(...bords.map((b) => b.x)) + MARGE;
  const z1 = cadre ? cadre.z + autour : Math.max(...bords.map((b) => b.z)) + MARGE;

  // Le texte est tracé dans le repère des mètres : sa taille doit suivre
  // l'échelle du cadre, sinon un plan large rend les noms illisibles et un
  // plan serré les fait déborder de leur pièce.
  const corps = Math.max(2.6, Math.min(x1 - x0, z1 - z0) / 26);

  const traits = liens.map((l) => {
    const a = centre.get(l.a), b = centre.get(l.b);
    return `<line class="ca-lien" x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}"/>`;
  }).join('');

  const salles = pieces.map((p) => {
    const classe = p.id === etat.courante ? 'ca-piece ca-ici' : 'ca-piece';
    const titre = noms
      ? `<text class="ca-nom" x="${p.x}" y="${p.z + corps * 0.36}"
          font-size="${corps}">${esc(p.titre)}</text>` : '';
    return `<g class="${classe}" data-carte-room="${esc(p.id)}">
      <rect x="${p.x - p.w / 2}" y="${p.z - p.d / 2}" width="${p.w}" height="${p.d}"
        rx="${Math.min(3, Math.min(p.w, p.d) / 6)}"/>${titre}</g>`;
  }).join('');

  const r = Math.max(2.5, Math.min(x1 - x0, z1 - z0) / 34);
  const mysteres = inconnues.map((m) => {
    const amorce = m.depuis
      ? `<line class="ca-amorce" x1="${m.depuis.x}" y1="${m.depuis.z}"
          x2="${m.x}" y2="${m.z}"/>` : '';
    return `${amorce}<g class="ca-inconnue"><circle cx="${m.x}" cy="${m.z}" r="${r}"/>
      <text x="${m.x}" y="${m.z + r * 0.52}" font-size="${r * 1.5}">?</text></g>`;
  }).join('');

  const moi = ici && vues.has(etat.courante)
    ? `<g class="ca-vous" transform="translate(${ici.x} ${ici.z}) rotate(${ici.cap.toFixed(1)})">
        <path d="M0,-${corps * 0.9} L${corps * 0.62},${corps * 0.72}
          L0,${corps * 0.28} L-${corps * 0.62},${corps * 0.72} Z"/></g>` : '';

  return `<svg class="ca-svg" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}"
    preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"
    >${traits}${mysteres}${salles}${moi}</svg>`;
}

/* ------------------------------------------------------------ minimap --- */

export function minimapActive() {
  try { return localStorage.getItem(CLE_MINIMAP) !== '0'; } catch { return true; }
}

export function setMinimap(app, on) {
  try {
    if (on) localStorage.removeItem(CLE_MINIMAP);
    else localStorage.setItem(CLE_MINIMAP, '0');
  } catch { /* stockage indisponible : le réglage ne survivra pas, tant pis */ }
  if (on) mountMinimap(app); else app._minimap?.dispose();
}

/**
 * La minimap : LA SALLE OÙ L'ON EST, et ses portes.
 *
 * Elle a d'abord montré un morceau du plan général — un fragment de plan de
 * métro dans un rond de neuf centimètres. Illisible : à cette échelle, les
 * traits entre salles ne disaient rien qu'on ne sût déjà, et la salle
 * courante s'y perdait. Une minimap répond à deux questions, et à deux
 * seulement : **où suis-je tourné**, et **où sont les portes**. Le reste est
 * le travail de la grande carte.
 *
 * Chaque porte porte donc son état, lisible d'un coup d'œil :
 *   • pleine        — passage déjà emprunté, on sait ce qu'il y a derrière ;
 *   • évidée        — jamais franchie, la salle d'après reste à découvrir ;
 *   • rouge         — fermée pour l'instant (délai de réarmement).
 */
export class Minimap {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.title = 'Carte de la visite (Échap → Pièces)';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', () => this.app.ouvrirCarte?.());

    this.redessiner();
    this._offMemoire = app.memoire?.onChange(() => this.redessiner());
    this._off = app.onUpdate((dt) => this._tick(dt));
  }

  get piece() { return this.app.rooms?.current ?? null; }

  redessiner() {
    const room = this.piece;
    this._id = room?.config.id ?? null;
    this._signature = this._sig();
    this.el.innerHTML = this._svg();
    this._aiguille = this.el.querySelector('.ca-vous');
    this._portes = [...this.el.querySelectorAll('[data-porte]')];
    this.el.hidden = !this.el.firstChild;
  }

  /** Ce qui, en changeant, oblige à refaire le tracé (et non à le bouger). */
  _sig() {
    const m = this.app.memoire;
    return `${this._id}:${m?.pieces.size ?? 0}:${m?.portes.size ?? 0}`
      + `:${(this.piece?.portalMeshes ?? []).length}`;
  }

  _svg() {
    const room = this.piece;
    if (!room) return '';
    const plan = planDe(this.app).pieces.find((p) => p.id === this._id);
    const w = plan?.w ?? 26;
    const d = plan?.d ?? 20;
    // Cadre carré, dont le CSS ne montre que le disque inscrit : une salle
    // carrée de côté s n'y tient qu'à partir d'un diamètre s√2. On prend un
    // peu plus, pour que les murs ne frôlent pas le bord du hublot.
    const cote = Math.max(w, d) * 1.62;
    const demi = cote / 2;

    const portes = (room.portalMeshes ?? []).map((mesh, i) => {
      const cfg = mesh.userData.portal?.cfg;
      if (!Array.isArray(cfg?.position)) return '';
      const [x, , z] = cfg.position;
      // la porte regarde vers l'intérieur : on la couche le long du mur
      const deg = Array.isArray(cfg.rotation) ? Number(cfg.rotation[1]) || 0 : 0;
      const t = Math.max(2.2, cote / 16);
      return `<g class="ca-porte" data-porte="${i}"
        transform="translate(${x} ${z}) rotate(${-deg})">
        <rect x="${-t * 0.62}" y="${-t * 0.22}" width="${t * 1.24}" height="${t * 0.44}"
          rx="${t * 0.14}"/></g>`;
    }).join('');

    const corps = Math.max(2.4, cote / 12);
    const moi = `<g class="ca-vous" transform="translate(0 0)">
      <path d="M0,-${corps * 0.62} L${corps * 0.42},${corps * 0.5}
        L0,${corps * 0.16} L-${corps * 0.42},${corps * 0.5} Z"/></g>`;

    return `<svg class="ca-svg" viewBox="${-demi} ${-demi} ${cote} ${cote}"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <rect class="ca-salle" x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}"
        rx="${Math.min(2.5, Math.min(w, d) / 8)}"/>${portes}${moi}</svg>`;
  }

  /**
   * Une aiguille se suit à l'œil : elle bouge donc à CHAQUE image. Ce n'est
   * pas un luxe — à quatre rafraîchissements par seconde elle sautait, et
   * une carte qui saute pendant qu'on tourne la tête est pire que pas de
   * carte. Le coût est d'un attribut `transform` par frame ; le tracé, lui,
   * ne se refait qu'en changeant de salle.
   */
  _tick() {
    if (this._id !== (this.piece?.config.id ?? null)
      || this._sig() !== this._signature) { this.redessiner(); return; }
    const room = this.piece;
    if (!room) return;

    if (this._aiguille) {
      // position DANS LA PIÈCE : le tracé est en coordonnées locales, et la
      // pièce peut être basculée (Escher) — lire la caméra en monde
      // poserait l'aiguille n'importe où
      const local = room.group.worldToLocal(_v.copy(this.app.camera.position));
      this.app.camera.getWorldDirection(_d);
      _d.applyQuaternion(room.group.getWorldQuaternion(_q).invert());
      const cap = (Math.atan2(_d.x, -_d.z) * 180) / Math.PI;
      this._aiguille.setAttribute('transform',
        `translate(${local.x.toFixed(2)} ${local.z.toFixed(2)}) rotate(${cap.toFixed(1)})`);
    }

    // l'état des portes : franchie, inconnue, ou fermée pour l'instant
    const memoire = this.app.memoire;
    const ici = room.config.id;
    for (const g of this._portes) {
      const mesh = room.portalMeshes[Number(g.dataset.porte)];
      if (!mesh) continue;
      const vers = mesh.userData.portal?.cfg?.to;
      // La porte par laquelle on vient d'entrer est fermée derrière soi :
      // elle ne rougit pas, ce serait annoncer un mur là où l'on a marché.
      // Sa marque tombe d'elle-même quand le passage se rouvre.
      if (mesh.userData.arrivee && !estFerme(mesh)) mesh.userData.arrivee = false;
      const fermee = estFerme(mesh) && !mesh.userData.arrivee;
      const prise = memoire ? memoire.aPris(ici, vers) : true;
      const classe = `ca-porte${fermee ? ' ca-fermee' : ''}${prise ? ' ca-prise' : ''}`;
      if (g.getAttribute('class') !== classe) g.setAttribute('class', classe);
    }
  }

  dispose() {
    this._off?.();
    this._offMemoire?.();
    this.el.remove();
    this.app._minimap = null;
  }
}

export function mountMinimap(app) {
  if (app._minimap) return app._minimap;
  app._minimap = new Minimap(app);
  return app._minimap;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
