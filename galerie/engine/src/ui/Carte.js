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
 * **Accessibilité** — dans le plan en grand, chaque salle est un vrai
 * bouton : atteignable au clavier, nommée, et qui mène où elle dit. La
 * minimap, elle, reste décorative (`aria-hidden`) : elle ne montre rien que
 * le plan ne dise mieux. Et la liste des pièces du menu suit exactement la
 * même mémoire — ce que la carte cache, la liste le cache aussi. Un plan
 * qui ménage la surprise à côté d'une liste qui la vend n'aurait rien
 * ménagé du tout.
 */
import * as THREE from 'three';
import { planGalerie } from '../core/planGalerie.js';
import { estFerme } from '../core/Cooldown.js';
import { t, onLangChange } from '../core/i18n.js';

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
 * Où se tient le visiteur sur le PLAN, et vers où il regarde.
 * Null hors d'une pièce connue.
 *
 * On mesure l'écart entre le visiteur et le centre de sa salle EN MONDE,
 * puis on reporte cet écart sur la salle telle qu'elle est dessinée. Passer
 * par le repère de la pièce serait faux dès qu'elle bascule : on marche
 * alors sur ce qui était un mur, et deux des trois coordonnées locales
 * cessent de décrire le sol. Le monde, lui, garde toujours le même bas.
 *
 * L'écart est borné à l'emprise dessinée : sur un plan de métro, mieux vaut
 * un point plaqué au bord de la bonne salle qu'un point juste au milieu de
 * la mauvaise.
 */
export function position(app) {
  const room = app.rooms?.current;
  if (!room) return null;
  const piece = planDe(app).pieces.find((p) => p.id === room.config.id);
  if (!piece) return null;
  room.group.updateMatrixWorld();
  const centre = _v2.setFromMatrixPosition(room.group.matrixWorld);
  const cam = app.camera.position;
  const borne = (v, demi) => Math.max(-demi, Math.min(demi, v));
  app.camera.getWorldDirection(_d);
  return {
    x: piece.x + borne(cam.x - centre.x, piece.w / 2),
    z: piece.z + borne(cam.z - centre.z, piece.d / 2),
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

/* ------------------------------------------------------- carte en grand --- */

/**
 * Le PLAN EN GRAND — l'autre moitié du travail.
 *
 * La minimap dit « où suis-je tourné, où sont les portes » ; le plan dit
 * « qu'ai-je parcouru, comment cela tient ensemble, où reste-t-il à aller ».
 * Longtemps il a vécu en vignette dans le menu de visite, sous une liste
 * des mêmes pièces : trois cent quatre-vingts pixels pour quinze salles,
 * des noms qui se chevauchaient, des traits qui se croisaient, et juste
 * dessous la même information en clair. Illisible et redondant à la fois.
 * Il prend donc toute la page, et il porte enfin ce qu'on vient y chercher.
 *
 * Deux principes de tracé :
 *
 *   • **les traits d'abord, les pièces ensuite** — un lien qui passe sous
 *     une salle se lit ; un lien qui passe dessus la barre ;
 *   • **le texte se mesure en PIXELS, pas en mètres.** Le SVG travaille en
 *     mètres (c'est le repère du plan) ; un `font-size` en mètres donne des
 *     noms minuscules sur une grande galerie et énormes sur une petite. On
 *     règle donc les tailles après coup, à l'échelle réelle du dessin —
 *     c'est `_ajusterEchelle`. Même raison pour `vector-effect`, qui garde
 *     les traits à leur épaisseur quel que soit le zoom.
 */
export function dessinerPlanGrand(app) {
  const etat = vu(app);
  const ici = position(app);
  const pieces = etat.pieces;
  if (!pieces.length) return '';
  const vues = new Set(pieces.map((p) => p.id));
  const centre = new Map([...pieces, ...etat.pressenties].map((p) => [p.id, p]));
  const liens = etat.liens.filter((l) => centre.has(l.a) && centre.has(l.b));

  // Sortir d'une pièce par le bord, dans une direction donnée : le point où
  // la demi-droite quitte le rectangle. Les traits partent de là et non du
  // centre — un lien qui traverse la salle qu'il relie ne se lit pas, et
  // douze liens partant d'un même centre font une étoile illisible.
  const bord = (p, vx, vz) => {
    const ax = Math.abs(vx) / (p.w / 2 || 1), az = Math.abs(vz) / (p.d / 2 || 1);
    const k = 1 / Math.max(ax, az, 1e-6);
    return { x: p.x + vx * k, z: p.z + vz * k };
  };

  // Une porte non franchie : un « ? » posé AU BORD de la pièce connue, du
  // côté où mène la porte. Sa vraie distance est justement ce qu'on ignore
  // encore — mais sa direction, elle, se sait.
  const inconnues = etat.pressenties.map((p) => {
    const voisin = etat.plan.portes.find(
      (l) => (l.a === p.id && vues.has(l.b)) || (l.b === p.id && vues.has(l.a)));
    const depuis = voisin ? centre.get(voisin.a === p.id ? voisin.b : voisin.a) : null;
    if (!depuis) return { depuis: null, x: p.x, z: p.z, ux: 0, uz: 1 };
    const vx = p.x - depuis.x, vz = p.z - depuis.z;
    const long = Math.hypot(vx, vz) || 1;
    const b = bord(depuis, vx, vz);
    return { depuis, x: b.x, z: b.z, ux: vx / long, uz: vz / long };
  });

  const bords = [
    ...pieces.flatMap((p) => [
      { x: p.x - p.w / 2, z: p.z - p.d / 2 }, { x: p.x + p.w / 2, z: p.z + p.d / 2 }]),
    ...inconnues.map((m) => ({ x: m.x, z: m.z }))
  ];
  const x0 = Math.min(...bords.map((b) => b.x)) - MARGE;
  const z0 = Math.min(...bords.map((b) => b.z)) - MARGE;
  const x1 = Math.max(...bords.map((b) => b.x)) + MARGE;
  const z1 = Math.max(...bords.map((b) => b.z)) + MARGE;

  // Les liens bombent légèrement, du même côté : deux salles reliées par
  // deux portes ne donnent plus un seul trait, et un trait qui frôle une
  // troisième salle la contourne au lieu de la traverser.
  const traits = liens.map((l) => {
    const a = centre.get(l.a), b = centre.get(l.b);
    const dx = b.x - a.x, dz = b.z - a.z;
    const long = Math.hypot(dx, dz) || 1;
    const da = bord(a, dx, dz), db = bord(b, -dx, -dz);
    const mx = (da.x + db.x) / 2, mz = (da.z + db.z) / 2;
    const fleche = long * 0.08;
    return `<path class="ca-lien" vector-effect="non-scaling-stroke"
      d="M${da.x.toFixed(1)} ${da.z.toFixed(1)} Q${(mx - (dz / long) * fleche).toFixed(1)}
      ${(mz + (dx / long) * fleche).toFixed(1)} ${db.x.toFixed(1)} ${db.z.toFixed(1)}"/>`;
  }).join('');

  const mysteres = inconnues.map((m) => {
    const amorce = '';   // le « ? » touche le bord : plus rien à amorcer
    return `${amorce}<g class="ca-inconnue" data-echelle="1"
      data-x="${m.x.toFixed(1)}" data-z="${m.z.toFixed(1)}"
      data-ux="${m.ux.toFixed(3)}" data-uz="${m.uz.toFixed(3)}">
      <circle cx="0" cy="0" r="1" vector-effect="non-scaling-stroke"/>
      <text x="0" y="0" dy="0.34em" font-size="1.5">?</text></g>`;
  }).join('');

  const prog = app.progression;
  const salles = pieces.map((p) => {
    const bilan = prog?.bilanDe?.(p.id) ?? { total: 0, vues: 0 };
    const ariaOeuvres = bilan.total
      ? ` — ${t('carte.oeuvres', { vues: bilan.vues, total: bilan.total,
        sv: bilan.vues > 1 ? 's' : '', st: bilan.total > 1 ? 's' : '' })}` : '';
    const courante = p.id === etat.courante;
    return `<g class="ca-piece${courante ? ' ca-ici' : ''}${bilan.total && bilan.vues >= bilan.total ? ' ca-complete' : ''}"
      data-carte-room="${esc(p.id)}" tabindex="0" role="button"
      aria-label="${esc(courante ? `${p.titre} — ${t('carte.ici')}${ariaOeuvres}`
        : t('carte.aller', { piece: p.titre }) + ariaOeuvres)}">
      <rect x="${p.x - p.w / 2}" y="${p.z - p.d / 2}" width="${p.w}" height="${p.d}"
        vector-effect="non-scaling-stroke"
        rx="${Math.min(3, Math.min(p.w, p.d) / 6)}"/></g>`;
  }).join('');

  // Les noms VIVENT À PART, au-dessus de tout, et sous la pièce qu'ils
  // nomment : écrits dedans, ils débordaient des petites salles et se
  // marchaient dessus dès que deux voisines se serraient.
  const etiquettes = pieces.map((p) => {
    const bilan = prog?.bilanDe?.(p.id) ?? { total: 0, vues: 0 };
    const compteur = bilan.total
      ? `<text class="ca-compteur${bilan.vues >= bilan.total ? ' ca-plein' : ''}"
          x="${p.x}" y="${p.z + p.d / 2}" dy="2.35em">◆ ${bilan.vues}/${bilan.total}</text>` : '';
    // `data-*` porte les deux places possibles : DANS la salle si le nom y
    // tient, SOUS elle sinon. Le choix se fait à l'écran, dans
    // `_ajusterEchelle` — c'est là seulement qu'on connaît la largeur du
    // texte et la taille réelle du rectangle.
    return `<g class="ca-etiquette${p.id === etat.courante ? ' ca-ici' : ''}"
      data-cx="${p.x}" data-cz="${p.z}" data-bas="${p.z + p.d / 2}"
      data-w="${p.w}" data-d="${p.d}">
      <text class="ca-nom" x="${p.x}" y="${p.z + p.d / 2}" dy="1.15em"
        >${esc(p.titre)}</text>${compteur}</g>`;
  }).join('');

  const moi = ici && vues.has(etat.courante)
    ? `<g class="ca-vous" data-echelle="1" data-x="${ici.x.toFixed(1)}"
        data-z="${ici.z.toFixed(1)}" data-cap="${ici.cap.toFixed(1)}">
        <path d="M0,-1 L0.68,0.8 L0,0.3 L-0.68,0.8 Z"/></g>` : '';

  return `<svg class="ca-svg ca-grand" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}"
    preserveAspectRatio="xMidYMid meet" role="group"
    aria-label="${esc(t('carte.titre'))}"
    >${traits}${mysteres}${salles}<g class="ca-etiquettes">${etiquettes}</g>${moi}</svg>`;
}

/**
 * Le plan en grand, sur toute la page.
 *
 * Ouvert depuis la minimap (un clic) ou depuis le menu de visite. Il se
 * ferme par Échap, par le ×, ou dès qu'on choisit une pièce — car chaque
 * salle du plan est un bouton : on clique, on y est.
 */
export class CartePleine {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'carte-pleine';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this._onTouche = (e) => {
      if (!this.ouverte) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.fermer(); }
    };
    this._onRedim = () => this._ajusterEchelle();
    window.addEventListener('keydown', this._onTouche, true);
    window.addEventListener('resize', this._onRedim);
    this._offLangue = onLangChange(() => { if (this.ouverte) this._peindre(); });
    this.ouverte = false;
  }

  ouvrir() {
    if (this.ouverte) return;
    this._peindre();
    this.ouverte = true;
    this.el.hidden = false;
    // le clavier appartient au plan : on ne marche pas en le lisant
    this.app.controls.suspended = true;
    this._inertes = [];
    for (const el of document.body.children) {
      if (el !== this.el && !el.inert) { el.inert = true; this._inertes.push(el); }
    }
    this._ajusterEchelle();
    (this.el.querySelector('.ca-ici') ?? this.el.querySelector('#cp-fermer'))?.focus();
  }

  fermer() {
    if (!this.ouverte) return;
    this.ouverte = false;
    this.el.hidden = true;
    this.app.controls.suspended = false;
    this.app.controls.resyncCollision?.();
    for (const el of this._inertes ?? []) el.inert = false;
    this._inertes = [];
  }

  basculer() { if (this.ouverte) this.fermer(); else this.ouvrir(); }

  _peindre() {
    const plan = dessinerPlanGrand(this.app);
    const total = this.app.rooms?.rooms?.size ?? 0;
    const connues = vu(this.app).pieces.length;
    const reste = Math.max(0, total - connues);
    const compte = reste
      ? t('carte.compte', { connues, reste, sc: connues > 1 ? 's' : '',
        sr: reste > 1 ? 's' : '' })
      : t('carte.complet', { connues });
    this.el.innerHTML = `
      <div class="cp-barre">
        <h2>${esc(t('carte.titre'))}</h2>
        <p class="cp-compte">${esc(compte)}</p>
        <button id="cp-fermer" type="button" aria-label="${esc(t('carte.fermer'))}">×</button>
      </div>
      <div class="cp-plan">${plan}</div>
      <p class="cp-legende">${esc(t('carte.legende'))}</p>`;
    this.el.querySelector('#cp-fermer')?.addEventListener('click', () => this.fermer());
    for (const g of this.el.querySelectorAll('[data-carte-room]')) {
      const aller = () => this._allerA(g.dataset.carteRoom);
      g.addEventListener('click', aller);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aller(); }
      });
    }
  }

  _allerA(id) {
    if (!id) return;
    this.fermer();
    if (id === this.app.rooms?.current?.config.id) return;
    this.app.derive?.arreter?.();
    this.app.activeFocus?.release?.();
    this.app.rooms?.setCurrent(id);
  }

  /**
   * Textes et symboles à taille CONSTANTE À L'ÉCRAN. Le SVG est en mètres :
   * on mesure l'échelle réellement appliquée (`preserveAspectRatio` retient
   * la plus petite des deux) et l'on convertit des pixels en mètres. Sans
   * cela, une galerie de deux cents mètres écrit ses noms en poussière.
   */
  _ajusterEchelle() {
    const svg = this.el.querySelector('.ca-grand');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const r = svg.getBoundingClientRect();
    if (!vb.width || !vb.height || !r.width || !r.height) return;
    const k = Math.min(r.width / vb.width, r.height / vb.height);
    if (!(k > 0)) return;
    const px = (n) => n / k;
    const corps = px(13);
    svg.querySelector('.ca-etiquettes')?.setAttribute('font-size', corps.toFixed(3));
    for (const g of svg.querySelectorAll('[data-echelle]')) {
      const s = px(g.classList.contains('ca-vous') ? 11 : 9);
      // le « ? » se pose AU BORD de la salle : on le décale de son propre
      // rayon vers le dehors, sinon il mord sur le rectangle
      const dx = Number(g.dataset.ux ?? 0) * s * 1.3;
      const dz = Number(g.dataset.uz ?? 0) * s * 1.3;
      g.setAttribute('transform',
        `translate(${(Number(g.dataset.x) + dx).toFixed(2)} ${(Number(g.dataset.z) + dz).toFixed(2)})`
        + (g.dataset.cap !== undefined ? ` rotate(${g.dataset.cap})` : '')
        + ` scale(${s.toFixed(3)})`);
    }
    // Le nom rentre DANS la salle quand elle est assez grande pour lui :
    // écrit dessous, il allait se poser sur la voisine du dessous dès que
    // deux salles se serraient, et le plan se mettait à mentir sur qui
    // s'appelle comment.
    for (const g of svg.querySelectorAll('.ca-etiquette')) {
      const nom = g.querySelector('.ca-nom');
      const compteur = g.querySelector('.ca-compteur');
      if (!nom) continue;
      const large = nom.getComputedTextLength() + corps * 0.8;
      const lignes = compteur ? 2.1 : 1.2;
      const dedans = Number(g.dataset.w) > large
        && Number(g.dataset.d) > corps * lignes * 1.9;
      g.classList.toggle('ca-dedans', dedans);
      const y = dedans
        ? Number(g.dataset.cz) - (compteur ? corps * 0.5 : 0)
        : Number(g.dataset.bas);
      nom.setAttribute('y', y.toFixed(2));
      nom.setAttribute('dy', dedans ? '0.34em' : '1.15em');
      compteur?.setAttribute('y', y.toFixed(2));
      compteur?.setAttribute('dy', dedans ? '1.9em' : '2.35em');
    }
    // Les étiquettes SOUS les salles s'évitent — et évitent les SALLES.
    // Deux voisines serrées écrivaient leur nom l'une sur l'autre, et le
    // nom d'une pièce fine (le couloir) s'étalait sur la salle d'à côté.
    // Pour chacune, du haut vers le bas : sa place normale est sous sa
    // salle ; si elle y mord une autre salle ou une étiquette déjà posée,
    // elle essaie AU-DESSUS de sa salle ; sinon elle reste dessous et
    // descend sous ce qui la gêne — descendre est le seul geste toujours
    // sûr, remonter la ferait entrer dans sa propre salle.
    const salles = [...svg.querySelectorAll('.ca-piece rect')].map((r) => ({
      x0: Number(r.getAttribute('x')), y0: Number(r.getAttribute('y')),
      x1: Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
      y1: Number(r.getAttribute('y')) + Number(r.getAttribute('height'))
    }));
    const heurte = (b, autres) => autres.some((a) =>
      b.x0 < a.x1 && b.x1 > a.x0 && b.y0 < a.y1 && b.y1 > a.y0);
    const posees = [];
    const sousLaSalle = [...svg.querySelectorAll('.ca-etiquette:not(.ca-dedans)')]
      .sort((a, b) => Number(a.dataset.bas) - Number(b.dataset.bas));
    for (const g of sousLaSalle) {
      const nom = g.querySelector('.ca-nom');
      if (!nom) continue;
      const compteur = g.querySelector('.ca-compteur');
      const largeur = nom.getComputedTextLength() + corps * 0.6;
      const haut = corps * (compteur ? 2.8 : 1.5);
      const cx = Number(g.dataset.cx);
      const bas = Number(g.dataset.bas);
      const sommet = bas - Number(g.dataset.d);
      // la salle de l'étiquette elle-même ne compte pas comme obstacle
      const autresSalles = salles.filter((s) =>
        Math.abs((s.x0 + s.x1) / 2 - cx) > 0.5 || Math.abs(s.y1 - bas) > 0.5);
      const demiW = Number(g.dataset.w) / 2;
      const boiteEn = (x, y) => ({ x0: x - largeur / 2, x1: x + largeur / 2,
        y0: y, y1: y + haut });
      const libre = (b) => b.x0 >= vb.x && b.x1 <= vb.x + vb.width
        && b.y0 >= vb.y && b.y1 <= vb.y + vb.height
        && !heurte(b, autresSalles) && !heurte(b, posees);
      // la passe se rejoue à chaque redimensionnement : on repart TOUJOURS
      // de la place normale, jamais de la place corrigée du tour d'avant
      let x = cx;
      let y = Number(nom.getAttribute('y'));
      let boite = boiteEn(x, y);
      g.querySelector('.ca-amorce')?.remove();
      nom.setAttribute('x', cx.toFixed(2));
      compteur?.setAttribute('x', cx.toFixed(2));
      if (!libre(boite)) {
        // dans l'ordre : au-dessus, à droite, à gauche de la salle — puis,
        // à défaut, on GLISSE vers le bas jusqu'à l'air libre (borné)
        const milieu = sommet + (bas - sommet) / 2 - haut / 2;
        const candidats = [
          [cx, sommet - haut - corps * 0.15],
          [cx + demiW + largeur / 2 + corps * 0.4, milieu],
          [cx - demiW - largeur / 2 - corps * 0.4, milieu]
        ];
        let trouve = false;
        for (const [ex, ey] of candidats) {
          const b = boiteEn(ex, ey);
          if (libre(b)) { x = ex; y = ey; boite = b; trouve = true; break; }
        }
        if (!trouve) {
          for (let n = 0; n < 24 && !libre(boite); n++) {
            y += corps * 0.5;
            boite = boiteEn(x, y);
          }
        }
        nom.setAttribute('x', x.toFixed(2));
        nom.setAttribute('y', y.toFixed(2));
        compteur?.setAttribute('x', x.toFixed(2));
        compteur?.setAttribute('y', y.toFixed(2));
        // une étiquette chassée LOIN de sa salle garde un fil vers elle,
        // sinon elle a l'air de nommer la voisine chez qui elle campe
        if (Math.hypot(x - cx, y + haut / 2 - (sommet + bas) / 2) > haut * 2.2) {
          const fil = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          fil.setAttribute('class', 'ca-amorce');
          fil.setAttribute('vector-effect', 'non-scaling-stroke');
          fil.setAttribute('x1', x.toFixed(2));
          fil.setAttribute('y1', (y + haut / 2).toFixed(2));
          fil.setAttribute('x2',
            Math.max(cx - demiW, Math.min(cx + demiW, x)).toFixed(2));
          fil.setAttribute('y2',
            Math.max(sommet, Math.min(bas, y + haut / 2)).toFixed(2));
          g.prepend(fil);
        }
      }
      posees.push(boite);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onTouche, true);
    window.removeEventListener('resize', this._onRedim);
    this._offLangue?.();
    this.el.remove();
  }
}

export function mountCartePleine(app) {
  if (!app._cartePleine) app._cartePleine = new CartePleine(app);
  return app._cartePleine;
}

/* ------------------------------------------------------------ minimap --- */

// Le répit accordé à la porte dont on vient de sortir avant de l'annoncer
// bloquée : le temps de se retourner, pas davantage.
const REPIT_ROUGE = 2500;

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
 *
 * **Tout se dessine en coordonnées MONDE, et c'est essentiel.** Une pièce
 * d'Escher bascule : le mur est devient le sol, et l'on marche dessus. En
 * repère de pièce, la position du visiteur cessait alors de bouger sur les
 * deux axes tracés — dix mètres de marche déplaçaient l'aiguille de neuf
 * centimètres, plaquée contre un bord. Or `orientRoom` fait exactement ce
 * qu'il faut : il tourne la pièce pour que la surface qu'on foule REPOSE
 * À PLAT dans le monde. Le monde est donc le seul repère où « le sol » veut
 * toujours dire la même chose, quelle que soit la gravité du moment.
 */
export class Minimap {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.title = 'Carte de la visite (Échap → Pièces)';
    document.body.appendChild(this.el);
    // le catalogue s'ouvre SOUS le hublot : il doit savoir qu'il est là
    document.body.classList.add('avec-minimap');
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
    this._dernierTransforme = null; // l'aiguille est neuve : reposer l'attribut
    this._portes = [...this.el.querySelectorAll('[data-porte]')];
    this.el.hidden = !this.el.firstChild;
  }

  /**
   * Ce qui, en changeant, oblige à refaire le tracé (et non à le bouger).
   * Le PLAN en fait partie : basculer la gravité retourne la pièce, donc
   * l'emprise, donc les portes qui tiennent debout.
   */
  _sig() {
    const m = this.app.memoire;
    return `${this._id}:${this.piece?.plane ?? 'sol'}`
      + `:${m?.pieces.size ?? 0}:${m?.portes.size ?? 0}`
      + `:${(this.piece?.portalMeshes ?? []).length}`;
  }

  /**
   * L'emprise de la salle, en MONDE : les huit coins de sa coque passés par
   * la matrice du groupe, projetés au sol. Basculée ou non, on obtient le
   * rectangle qu'occupe vraiment la salle sous les pieds du visiteur — et
   * c'est ce rectangle qu'il faut dessiner, pas la largeur × profondeur du
   * JSON, qui ne décrit que la pièce à plat.
   */
  _emprise(room) {
    const shell = room.config.shell && room.config.shell !== true ? room.config.shell : {};
    const plan = planDe(this.app).pieces.find((p) => p.id === this._id);
    const w = Number(shell.width) > 0 ? shell.width : (plan?.w ?? 26);
    const d = Number(shell.depth) > 0 ? shell.depth : (plan?.d ?? 20);
    const h = Number(shell.height) > 0 ? shell.height : 5;
    room.group.updateMatrixWorld();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const sx of [-w / 2, w / 2]) {
      for (const sy of [0, h]) {
        for (const sz of [-d / 2, d / 2]) {
          _v.set(sx, sy, sz).applyMatrix4(room.group.matrixWorld);
          x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x);
          z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
        }
      }
    }
    return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
      w: x1 - x0, d: z1 - z0 };
  }

  _svg() {
    const room = this.piece;
    if (!room) return '';
    const e = this._emprise(room);
    // Cadre carré, dont le CSS ne montre que le disque inscrit : une salle
    // carrée de côté s n'y tient qu'à partir d'un diamètre s√2. On prend un
    // peu plus, pour que les murs ne frôlent pas le bord du hublot.
    const cote = Math.max(e.w, e.d) * 1.62;
    const demi = cote / 2;
    const t = Math.max(2.2, cote / 16);

    // On ne dessine que les portes QU'ON PEUT PRENDRE d'ici : dans une pièce
    // basculée, celles des autres plans sont couchées sur ce qui est devenu
    // un mur — le moteur refuse déjà de les franchir à la marche (voir le
    // test « portail DEBOUT » de RoomManager.update). Les montrer serait
    // promettre des passages qui n'en sont pas d'ici.
    const portes = (room.portalMeshes ?? []).map((mesh, i) => {
      mesh.updateMatrixWorld();
      _d.set(0, 1, 0).transformDirection(mesh.matrixWorld);
      if (_d.y < 0.7) return '';
      mesh.getWorldPosition(_v);
      // le cap de la porte, à plat : son axe local X couché dans le monde
      _d2.set(1, 0, 0).transformDirection(mesh.matrixWorld);
      const deg = (Math.atan2(_d2.x, -_d2.z) * 180) / Math.PI;
      return `<g class="ca-porte" data-porte="${i}"
        transform="translate(${_v.x.toFixed(2)} ${_v.z.toFixed(2)}) rotate(${deg.toFixed(1)})">
        <rect x="${-t * 0.62}" y="${-t * 0.22}" width="${t * 1.24}" height="${t * 0.44}"
          rx="${t * 0.14}"/></g>`;
    }).join('');

    const corps = Math.max(2.4, cote / 12);
    const moi = `<g class="ca-vous" transform="translate(0 0)">
      <path d="M0,-${corps * 0.62} L${corps * 0.42},${corps * 0.5}
        L0,${corps * 0.16} L-${corps * 0.42},${corps * 0.5} Z"/></g>`;

    return `<svg class="ca-svg"
      viewBox="${(e.cx - demi).toFixed(2)} ${(e.cz - demi).toFixed(2)} ${cote.toFixed(2)} ${cote.toFixed(2)}"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <rect class="ca-salle" x="${e.x0.toFixed(2)}" y="${e.z0.toFixed(2)}"
        width="${e.w.toFixed(2)}" height="${e.d.toFixed(2)}"
        rx="${Math.min(2.5, Math.min(e.w, e.d) / 8)}"/>${portes}${moi}</svg>`;
  }

  /**
   * Une aiguille se suit à l'œil : elle bouge donc à CHAQUE image. Ce n'est
   * pas un luxe — à quatre rafraîchissements par seconde elle sautait, et
   * une carte qui saute pendant qu'on tourne la tête est pire que pas de
   * carte. Le coût est d'un attribut `transform` par frame ; le tracé, lui,
   * ne se refait qu'en changeant de salle ou de gravité.
   */
  _tick(dt) {
    if (this._id !== (this.piece?.config.id ?? null)
      || this._sig() !== this._signature) { this.redessiner(); return; }
    const room = this.piece;
    if (!room) return;

    if (this._aiguille) {
      // En MONDE, sans détour : après une bascule, c'est la pièce qui a
      // tourné, pas le visiteur — sa position au sol se lit donc toujours
      // sur les mêmes deux axes.
      const cam = this.app.camera;
      cam.getWorldDirection(_d);
      const capDeg = (Math.atan2(_d.x, -_d.z) * 180) / Math.PI;
      const transforme =
        `translate(${cam.position.x.toFixed(2)} ${cam.position.z.toFixed(2)})`
        + ` rotate(${capDeg.toFixed(1)})`;
      // immobile, on ne touche pas au DOM : poser le même attribut 120 fois
      // par seconde invalide le style de l'aiguille pour rien
      if (transforme !== this._dernierTransforme) {
        this._dernierTransforme = transforme;
        this._aiguille.setAttribute('transform', transforme);
      }
    }

    // L'état des portes change à l'échelle de la MINUTE (une porte se
    // franchit, se ferme) : quatre relevés par seconde le montrent aussi
    // vite que l'œil le lit, sans payer estFerme + aPris à chaque frame.
    this._accPortes = (this._accPortes ?? 0) + (dt ?? 1 / 60);
    if (this._accPortes < 0.25) return;
    this._accPortes = 0;

    // l'état des portes : franchie, inconnue, ou fermée pour l'instant
    const memoire = this.app.memoire;
    const ici = room.config.id;
    for (const g of this._portes) {
      const mesh = room.portalMeshes[Number(g.dataset.porte)];
      if (!mesh) continue;
      const vers = mesh.userData.portal?.cfg?.to;
      // La porte par laquelle on vient d'entrer se ferme derrière soi : on
      // lui laisse un répit avant de l'annoncer en rouge — le temps de trois
      // pas — puis on le dit. Une porte fermée qu'on ne montrerait pas
      // fermée serait pire que le clignotement qu'on voulait éviter.
      //
      // `arriveeA` vaut Infinity pendant la traversée (répit en cours), un
      // instant après l'atterrissage, et rien du tout pour une porte par
      // laquelle on n'est pas entré — les trois cas se lisent d'un trait.
      const repit = performance.now() - (mesh.userData.arriveeA ?? -Infinity) < REPIT_ROUGE;
      const fermee = estFerme(mesh) && !repit;
      const prise = memoire ? memoire.aPris(ici, vers) : true;
      const classe = `ca-porte${fermee ? ' ca-fermee' : ''}${prise ? ' ca-prise' : ''}`;
      if (g.getAttribute('class') !== classe) g.setAttribute('class', classe);
    }
  }

  dispose() {
    this._off?.();
    this._offMemoire?.();
    this.el.remove();
    document.body.classList.remove('avec-minimap');
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
const _d2 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
