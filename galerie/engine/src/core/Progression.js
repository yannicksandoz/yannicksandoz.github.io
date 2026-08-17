import { t, onLangChange } from './i18n.js';

/**
 * Progression de la visite : quelles ŒUVRES (role ≠ decor) le visiteur a
 * découvertes. Une œuvre est découverte après quelques secondes passées à
 * portée, ou dès qu'on l'approche (FocusCamera). L'état persiste d'une
 * session à l'autre (localStorage) : on ne redécouvre pas ce qu'on connaît.
 *
 * C'est la source de vérité commune : le badge « 3 / 6 », les balises
 * lumineuses des œuvres non visitées, la boussole d'écran et le chapeau
 * de fin (TipJar) s'y abonnent tous — aucun ne recompte de son côté.
 */

const CLE = 'galerie-decouvertes';
const RAYON = 10;   // à portée = on l'entend, on la voit
const PALIER = 3;   // secondes à portée avant de compter la découverte

export class Progression {
  constructor(app) {
    this.app = app;
    this.decouvertes = new Set(this._lire());
    this._dwell = new Map(); // artwork → secondes cumulées à portée
    this._abonnes = new Set();
    this._debut = performance.now();

    this._badge = null;
    app.onUpdate((dt) => this._tick(dt));
  }

  /** Toutes les œuvres au sens fort — le décor ne compte pas. */
  get oeuvres() {
    return this.app.artworks.filter((a) => a.config.role !== 'decor');
  }

  get total() {
    return this.oeuvres.length;
  }

  get compte() {
    // ne compter que ce qui existe encore (une œuvre retirée du JSON ne
    // doit pas gonfler le score d'une vieille session)
    const ids = new Set(this.oeuvres.map((a) => a.config.id));
    let n = 0;
    for (const id of this.decouvertes) if (ids.has(id)) n++;
    return n;
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
    if (this.decouvertes.has(artwork.config.id)) return;
    this.decouvertes.add(artwork.config.id);
    this._ecrire();
    this._notifier();
  }

  onChange(fn) {
    this._abonnes.add(fn);
    return () => this._abonnes.delete(fn);
  }

  _notifier() {
    for (const fn of this._abonnes) fn(this);
    this._peindreBadge();
  }

  _tick(dt) {
    // le temps passé À PORTÉE s'accumule ; loin, il s'évapore doucement —
    // traverser en courant ne compte pas, s'attarder compte
    for (const a of this.oeuvres) {
      if (this.decouvertes.has(a.config.id)) continue;
      const proche = a.distance < RAYON;
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

  /* ------------------------------------------------------------ badge --- */

  /**
   * Badge discret « 3 / 6 » (haut-droite). role="status" : un lecteur
   * d'écran annonce chaque découverte, sans que le badge vole le focus.
   */
  montrerBadge() {
    if (this._badge || this.total === 0) return;
    const el = document.createElement('div');
    el.id = 'progress-badge';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    this._badge = el;
    this._peindreBadge();
    onLangChange(() => this._peindreBadge());
  }

  _peindreBadge() {
    if (!this._badge) return;
    const texte = t('progress.label', { n: this.compte, total: this.total });
    this._badge.textContent = `◆ ${this.compte} / ${this.total}`;
    this._badge.title = texte;
    this._badge.setAttribute('aria-label', texte);
  }
}

/** Point d'entrée : construit et attache la progression à l'app. */
export function mountProgression(app) {
  if (!app.progression) app.progression = new Progression(app);
  return app.progression;
}
