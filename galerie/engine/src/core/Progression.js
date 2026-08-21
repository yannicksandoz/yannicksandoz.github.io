import * as THREE from 'three';
import { t, onLangChange } from './i18n.js';
import { estOeuvre } from './catalogue.js';

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
 * l'approche (FocusCamera). Le catalogue SE GARDE d'une visite à l'autre
 * (`Memoire`) : une galerie de cette taille ne se traverse pas d'un trait,
 * et effacer entre deux sessions punissait qui revient. « Recommencer la
 * visite » (menu) rend la liste de « ??? » du premier jour. Les œuvres
 * composées (`partOf`) comptent pour une : n'importe lequel de leurs
 * membres les révèle.
 */

const RAYON = 10;   // à portée = on l'entend, on la voit
const PALIER = 3;   // secondes à portée avant de compter la découverte

export class Progression {
  constructor(app) {
    this.app = app;
    // Les deux ensembles VIVENT dans la mémoire de visite : ce sont les
    // siens, la progression ne fait que s'en servir. Sans mémoire (stockage
    // refusé), `mountMemoire` en fournit une qui n'écrit nulle part — le
    // code d'ici n'a donc jamais à savoir s'il est mémorisé ou non.
    this.decouvertes = app.memoire?.oeuvres ?? new Set();
    // Révélées par un jeton ◈ : le NOM et la pièce sont dévoilés dans la
    // liste, mais la découverte (compteur, visite guidée) reste à faire
    // sur place — le jeton est un indice, pas un raccourci.
    this.revelees = app.memoire?.revelees ?? new Set();
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
    return this.app.artworks.filter((a) => estOeuvre(a.config));
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

  /** Les œuvres d'UNE pièce, dans l'ordre du catalogue. */
  parcoursDe(roomId) {
    return this.parcours.filter((a) => a.room?.config.id === roomId);
  }

  /** Ce qu'une pièce contient, et ce qu'on y a déjà rencontré. */
  bilanDe(roomId) {
    let total = 0, vues = 0;
    for (const a of this.oeuvres) {
      if (a.room?.config.id !== roomId) continue;
      total++;
      if (this.estDecouverte(a)) vues++;
    }
    return { total, vues };
  }

  /** Pièces de la galerie où l'on n'a jamais mis les pieds. */
  get piecesInconnues() {
    const salles = this.app.rooms?.rooms;
    if (!salles) return 0;
    const vues = this.app.memoire?.pieces;
    if (!vues) return 0;
    let n = 0;
    for (const id of salles.keys()) if (!vues.has(id)) n++;
    return n;
  }

  /** Minutes écoulées depuis l'entrée dans la galerie. */
  get minutes() {
    return (performance.now() - this._debut) / 60000;
  }

  estDecouverte(artwork) {
    return this.decouvertes.has(artwork.config.id);
  }

  estRevelee(artwork) {
    return this.revelees.has(artwork.config.id);
  }

  /**
   * Ajoute à la mémoire de visite, et rend true si c'était nouveau. Le
   * repli (pas de mémoire du tout) garde le même contrat, pour que
   * l'appelant n'ait jamais à distinguer les deux cas.
   */
  _noter(champ, id) {
    if (this.app.memoire) return this.app.memoire.noter(champ, id);
    const set = champ === 'oeuvres' ? this.decouvertes : this.revelees;
    if (set.has(id)) return false;
    set.add(id);
    return true;
  }

  /** Dévoile une « ??? » contre un jeton ◈. Renvoie false faute de jeton. */
  reveler(artwork) {
    if (!artwork || this.estDecouverte(artwork) || this.estRevelee(artwork)) return false;
    if (!this.app.jetons?.depenser(1)) return false;
    this._noter('revelees', artwork.config.id);
    this._notifier();
    return true;
  }

  /** Découverte immédiate (approche d'une œuvre au clic/Espace). */
  marquer(artwork) {
    if (!artwork || artwork.config.role === 'decor') return;
    const id = artwork.config.partOf ?? artwork.config.id;
    if (!this._noter('oeuvres', id)) return;
    this.nouvelles++;
    this._notifier();
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  _notifier() {
    for (const fn of this._abonnes) fn(this);
    this._peindre();
    // les portes annoncent le contenu des salles voisines : une découverte
    // change ce qu'elles disent, et elles doivent le dire tout de suite
    this.app.rooms?.rafraichirEtiquettes?.();
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
      // On ne découvre que ce qui est DANS LA PIÈCE où l'on se tient : les
      // pièces adjacentes, préchargées, sont superposées à l'origine
      // (invisibles) — leurs distances sont géométriquement vraies mais
      // physiquement fausses, et l'écho de l'annexe se « découvrait » à
      // travers le mur en marchant dans le labo.
      if (a.room && a.room.state !== 'current') {
        this._dwell.set(a, 0);
        continue;
      }
      const d = Math.min(a.distance, minMembres?.get(a.config.id) ?? Infinity);
      const proche = d < RAYON;
      const acc = (this._dwell.get(a) ?? 0) + (proche ? dt : -dt * 0.5);
      this._dwell.set(a, Math.max(0, acc));
      if (acc >= PALIER) this.marquer(a);
    }
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
    // La salle de départ n'a jamais vu passer un changement de pièce : sans
    // ce premier appel, ses portes resteraient muettes jusqu'au premier pas.
    this.app.rooms?.rafraichirEtiquettes?.();
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

  /**
   * Le badge et son panneau ne parlent que de LA SALLE OÙ L'ON EST.
   *
   * Un « ◆ 3 / 47 » global écrasait le visiteur dès le premier pas : le
   * chiffre ne bougeait presque jamais, et la liste dépliée était un
   * inventaire de la galerie entière — exactement ce que la carte s'était
   * donné du mal à ne pas divulguer. Ramené à la pièce, le compteur se
   * remplit vite, se vide en changeant de salle, et redevient ce qu'il
   * doit être : « ai-je fait le tour d'ici ? ». Ce qu'il y a AILLEURS se
   * lit sur les portes (« ◆ 1 / 4 », voir `peindreEtiquette`) et sur la
   * carte, pas dans un total qui ne veut rien dire.
   */
  _peindre() {
    if (!this._badge) return;
    const jetons = this.app.jetons?.compte ?? 0;
    const salle = this.app.rooms?.current?.config.id ?? null;
    const bilan = salle ? this.bilanDe(salle) : { total: 0, vues: 0 };
    const texte = t('progress.label', { n: bilan.vues, total: bilan.total })
      + (jetons > 0 ? ` · ${t('progress.jetons', { n: jetons })}` : '');
    this._badge.textContent = `◆ ${bilan.vues} / ${bilan.total}`
      + (jetons > 0 ? `  ·  ◈ ${jetons}` : '');
    this._badge.title = texte;
    this._badge.setAttribute('aria-label', texte);
    // Une salle sans œuvre affiche « ◆ 0 / 0 » plutôt que de disparaître :
    // c'est une information (il n'y a rien à chercher ici), et c'est par ce
    // bouton qu'on ouvre le panneau — lequel dit justement où aller.
    if (this._panneau.hidden) return;

    const reste = bilan.total - bilan.vues;
    const lignes = this.parcoursDe(salle).map((a, i) => {
      const vue = this.estDecouverte(a);
      const revelee = !vue && this.estRevelee(a);
      // une ??? se DÉVOILE contre un jeton : la ligne devient cliquable
      const devoilable = !vue && !revelee && jetons > 0;
      const titre = (vue || revelee) ? (a.config.title ?? a.config.id) : '???';
      const attrs = vue
        ? `data-work="${esc(a.config.id)}" class="vue"`
        : devoilable
          ? `data-reveal="${esc(a.config.id)}" class="a-reveler"
             title="${esc(t('progress.reveler'))}" aria-label="${esc(t('progress.reveler'))}"`
          : `disabled aria-disabled="true" class="${revelee ? 'revelee' : 'inconnue'}"
             ${revelee ? `title="${esc(t('progress.revelee'))}"` : ''}`;
      return `<li><button type="button" ${attrs}>
        <span class="pl-n">${i + 1}</span>
        <span class="pl-t">${esc(titre)}${revelee ? ' ◈' : ''}${devoilable ? ' <span class="pl-j">◈</span>' : ''}</span></button></li>`;
    }).join('');

    const inconnues = this.piecesInconnues;
    const jetonsAstuce = reste > 0 && this.app.jetons?.total > 0
      ? `<p class="pl-astuce">${esc(t('progress.jetons.hint'))}</p>` : '';
    this._panneau.innerHTML = `
      <h2>${esc(this.app.rooms?.current?.config.title ?? t('progress.title'))}</h2>
      ${bilan.total ? `<ul role="list">${lignes}</ul>`
    : `<p class="pl-astuce">${esc(t('progress.vide'))}</p>`}
      ${reste > 0 ? `<p class="pl-astuce">${esc(t('progress.hint', { n: reste }))}</p>` : ''}
      ${jetonsAstuce}
      ${inconnues > 0
    ? `<p class="pl-ailleurs">${esc(t('progress.ailleurs', { n: inconnues }))}</p>` : ''}`;

    for (const b of this._panneau.querySelectorAll('[data-work]')) {
      b.addEventListener('click', () => {
        const art = this.app.artworks.find((a) => a.config.id === b.dataset.work);
        if (!art) return;
        this.basculerPanneau(false);
        this.app.derive?.arreter?.();
        allerVersOeuvre(this.app, art);
      });
    }
    // dévoiler une ??? : le panneau reste ouvert, la ligne se repeint avec
    // son nom — et le focus reste où l'on vient de cliquer
    for (const b of this._panneau.querySelectorAll('[data-reveal]')) {
      b.addEventListener('click', () => {
        const art = this.app.artworks.find((a) => a.config.id === b.dataset.reveal);
        if (!art || !this.reveler(art)) return;
        const n = b.querySelector('.pl-n')?.textContent;
        this._panneau.querySelectorAll('.pl-n').forEach((el) => {
          if (el.textContent === n) el.closest('button')?.focus();
        });
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
