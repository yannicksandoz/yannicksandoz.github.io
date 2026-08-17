import * as THREE from 'three';
import { t, onLangChange } from './i18n.js';

/**
 * Progression de la visite — et INDEX des œuvres.
 *
 * Le pari : une œuvre n'entre au catalogue qu'une fois rencontrée. Tant
 * qu'elle ne l'est pas, elle existe (on sait qu'il y en a une de plus, on
 * la voit signalée dans l'espace) mais elle n'est pas nommée : « ??? ».
 * Le compteur « 2 / 7 » se déplie d'un clic et devient la table des
 * matières de ce qu'on a trouvé — chaque titre y ramène.
 *
 * Une œuvre est découverte après quelques secondes à portée, ou dès qu'on
 * l'approche (FocusCamera). L'état persiste (localStorage) : on ne
 * redécouvre pas ce qu'on connaît. Les œuvres composées (`partOf`) comptent
 * pour une : n'importe lequel de leurs membres les révèle.
 */

const CLE = 'galerie-decouvertes';
const RAYON = 10;   // à portée = on l'entend, on la voit
const PALIER = 3;   // secondes à portée avant de compter la découverte

export class Progression {
  constructor(app) {
    this.app = app;
    this.decouvertes = new Set(this._lire());
    // Découvertes faites DANS CETTE SESSION : le chapeau de fin s'y adosse.
    // Sans cela, un visiteur qui revient (tout est déjà dans son stockage)
    // recevait l'écran « soutenir l'artiste » au premier pas.
    this.nouvelles = 0;
    this._dwell = new Map(); // artwork → secondes cumulées à portée
    this._abonnes = new Set();
    this._debut = performance.now();

    this._badge = null;
    this._panneau = null;
    app.onUpdate((dt) => this._tick(dt));
  }

  /** Toutes les œuvres au sens fort — ni décor, ni membre d'un ensemble. */
  get oeuvres() {
    return this.app.artworks.filter(
      (a) => a.config.role !== 'decor' && !a.config.partOf);
  }

  /** Les œuvres dans l'ordre de la galerie (pièce par pièce). */
  get parcours() {
    const ordre = [...(this.app.rooms?.rooms?.values() ?? [])];
    const rang = new Map(ordre.map((r, i) => [r.config.id, i]));
    return this.oeuvres.slice().sort((a, b) => {
      const ra = rang.get(a.room?.config.id) ?? 99;
      const rb = rang.get(b.room?.config.id) ?? 99;
      return ra - rb || a.config.id.localeCompare(b.config.id);
    });
  }

  /** Celles que le visiteur a rencontrées — la visite guidée les rejoue. */
  get indexees() {
    return this.parcours.filter((a) => this.estDecouverte(a));
  }

  get total() {
    return this.oeuvres.length;
  }

  get compte() {
    return this.indexees.length;
  }

  get complet() {
    return this.total > 0 && this.compte >= this.total;
  }

  /** Minutes écoulées depuis l'entrée dans la galerie. */
  get minutes() {
    return (performance.now() - this._debut) / 60000;
  }

  estDecouverte(artwork) {
    return this.decouvertes.has(artwork.config.id);
  }

  /** Découverte immédiate (approche d'une œuvre au clic/Espace). */
  marquer(artwork) {
    if (!artwork || artwork.config.role === 'decor') return;
    const id = artwork.config.partOf ?? artwork.config.id;
    if (this.decouvertes.has(id)) return;
    this.decouvertes.add(id);
    this.nouvelles++;
    this._ecrire();
    this._notifier();
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  _notifier() {
    for (const fn of this._abonnes) fn(this);
    this._peindre();
  }

  _tick(dt) {
    // un ensemble s'étend : être près de N'IMPORTE QUEL membre (partOf),
    // c'est être près de l'œuvre — on retient la distance minimale
    let minMembres = null;
    for (const a of this.app.artworks) {
      const pid = a.config.partOf;
      if (!pid) continue;
      minMembres ??= new Map();
      const d = minMembres.get(pid);
      if (d === undefined || a.distance < d) minMembres.set(pid, a.distance);
    }
    // le temps passé À PORTÉE s'accumule ; loin, il s'évapore doucement —
    // traverser en courant ne compte pas, s'attarder compte
    for (const a of this.oeuvres) {
      if (this.decouvertes.has(a.config.id)) continue;
      const d = Math.min(a.distance, minMembres?.get(a.config.id) ?? Infinity);
      const proche = d < RAYON;
      const acc = (this._dwell.get(a) ?? 0) + (proche ? dt : -dt * 0.5);
      this._dwell.set(a, Math.max(0, acc));
      if (acc >= PALIER) this.marquer(a);
    }
  }

  _lire() {
    try { return JSON.parse(localStorage.getItem(CLE) || '[]'); } catch { return []; }
  }

  _ecrire() {
    try { localStorage.setItem(CLE, JSON.stringify([...this.decouvertes])); } catch { /* stockage refusé */ }
  }

  /* ------------------------------------------------------- catalogue --- */

  /**
   * Compteur « ◆ 2 / 7 » (haut-droite) : un BOUTON qui déplie le catalogue.
   * Les œuvres trouvées y portent leur titre et s'y rejoignent d'un clic ;
   * les autres tiennent leur rang sous un « ??? ».
   */
  montrerBadge() {
    if (this._badge || this.total === 0) return;

    const badge = document.createElement('button');
    badge.id = 'progress-badge';
    badge.type = 'button';
    badge.setAttribute('aria-expanded', 'false');
    badge.setAttribute('aria-controls', 'progress-list');

    const panneau = document.createElement('div');
    panneau.id = 'progress-list';
    panneau.hidden = true;

    badge.addEventListener('click', () => this.basculerPanneau());
    // Échap referme le catalogue sans remonter au menu de la visite
    panneau.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.basculerPanneau(false);
      badge.focus();
    });

    document.body.append(badge, panneau);
    this._badge = badge;
    this._panneau = panneau;
    this._peindre();
    onLangChange(() => this._peindre());
  }

  basculerPanneau(ouvrir = null) {
    if (!this._panneau) return;
    const veut = ouvrir ?? this._panneau.hidden;
    this._panneau.hidden = !veut;
    this._badge.setAttribute('aria-expanded', String(veut));
    if (veut) {
      this._peindre();
      this._panneau.querySelector('button:not([disabled])')?.focus();
    }
  }

  _peindre() {
    if (!this._badge) return;
    const texte = t('progress.label', { n: this.compte, total: this.total });
    this._badge.textContent = `◆ ${this.compte} / ${this.total}`;
    this._badge.title = texte;
    this._badge.setAttribute('aria-label', texte);
    if (this._panneau.hidden) return;

    const reste = this.total - this.compte;
    const lignes = this.parcours.map((a, i) => {
      const vue = this.estDecouverte(a);
      const titre = vue ? (a.config.title ?? a.config.id) : '???';
      const salle = vue ? (a.room?.config.title ?? '') : '';
      return `<li><button type="button" data-work="${esc(a.config.id)}"
        ${vue ? '' : 'disabled aria-disabled="true"'}
        class="${vue ? 'vue' : 'inconnue'}">
        <span class="pl-n">${i + 1}</span>
        <span class="pl-t">${esc(titre)}</span>
        <span class="pl-s">${esc(salle)}</span></button></li>`;
    }).join('');

    this._panneau.innerHTML = `
      <h2>${esc(t('progress.title'))}</h2>
      <ul role="list">${lignes}</ul>
      ${reste > 0 ? `<p class="pl-astuce">${esc(t('progress.hint', { n: reste }))}</p>` : ''}`;

    for (const b of this._panneau.querySelectorAll('[data-work]')) {
      b.addEventListener('click', () => {
        const art = this.app.artworks.find((a) => a.config.id === b.dataset.work);
        if (!art) return;
        this.basculerPanneau(false);
        this.app.derive?.arreter?.();
        allerVersOeuvre(this.app, art);
      });
    }
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Pose le visiteur devant une œuvre — sa pièce d'abord, puis le point de
 * vue que sa fiche déclare. Partagé par le catalogue, les liens profonds
 * et la visite guidée : une seule façon d'arriver devant une œuvre.
 */
export async function allerVersOeuvre(app, art, { instant = false } = {}) {
  const salle = art.room?.config.id;
  if (salle && app.rooms.current?.config.id !== salle) {
    await app.rooms.setCurrent(salle, { instant });
  }
  art.room?.group.updateMatrixWorld(true);
  const vue = pointDeVue(app, art);
  app.camera.position.copy(vue.pos);
  app.controls.orbit.target.copy(vue.cible);
  app.controls.resyncCollision?.();
}

/**
 * Point de vue de contemplation d'une œuvre : la distance déclarée par son
 * module FocusCamera, le centre VU de l'objet (jamais son origine, qui est
 * au sol pour une construction voxel), et un regard à hauteur d'homme.
 */
export function pointDeVue(app, art, depuis = null) {
  const centre = art.group.getWorldPosition(new THREE.Vector3());
  if (art.mesh) {
    const boite = new THREE.Box3().setFromObject(art.mesh);
    if (!boite.isEmpty()) boite.getCenter(centre);
  }
  const dist = Math.min(18, Math.max(4.5,
    art.config.modules?.find((m) => m.type === 'FocusCamera')
      ?.params?.distance ?? 6));
  // on aborde l'œuvre depuis là où l'on est ; à défaut, par sa face avant
  const de = depuis ?? app.camera.position;
  const dir = de.clone().sub(centre).setY(0);
  if (dir.lengthSq() < 0.04) {
    dir.set(0, 0, 1).applyQuaternion(art.group.quaternion).setY(0);
  }
  if (dir.lengthSq() < 0.04) dir.set(0, 0, 1);
  dir.normalize();
  const pos = centre.clone().addScaledVector(dir, dist);
  const solY = (art.room?.group.position.y ?? 0) + 1.7;
  pos.y = Math.max(centre.y + 0.6, solY);
  const cible = centre.clone();
  cible.y = centre.y + 0.25;   // le regard porte à niveau, pas vers le sol
  return { pos, cible };
}

/** Point d'entrée : construit et attache la progression à l'app. */
export function mountProgression(app) {
  if (!app.progression) app.progression = new Progression(app);
  return app.progression;
}
