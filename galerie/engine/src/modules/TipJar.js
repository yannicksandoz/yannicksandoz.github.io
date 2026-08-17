import { Module } from './Module.js';

/**
 * « Chapeau » de fin d'expérience : quand le visiteur a approché toutes les
 * œuvres, un écran discret propose de soutenir l'artiste. Le bouton ouvre
 * une URL de paiement hébergée par un prestataire (Ko-fi, Stripe Payment
 * Link, PayPal.me…) dans un nouvel onglet — aucune donnée bancaire ne
 * transite par le site, qui reste 100 % statique.
 *
 * À attacher à une seule œuvre (n'importe laquelle) : le module observe la
 * galerie entière.
 *
 * params :
 *  - enabled     (défaut true) : false → module totalement inerte
 *  - url         (requis) : lien de paiement hébergé ; vide → inerte
 *  - message     (défaut fourni) : texte de l'écran de fin
 *  - buttonLabel (défaut « Soutenir l'artiste »)
 *  - visitRadius (défaut 9) : distance à laquelle une œuvre compte comme « visitée »
 *  - delay       (défaut 2) : secondes entre la dernière visite et l'apparition
 */
export class TipJar extends Module {
  init() {
    const p = this.params;
    this.active = p.enabled !== false && typeof p.url === 'string' && p.url.length > 0;
    if (!this.active) return;

    this.visited = new WeakSet();
    this.visitedCount = 0;
    this.shownOnce = false;
    this._countdown = null;

    this.overlay = document.getElementById('tipjar-overlay');
    this.corner = document.getElementById('tipjar-corner');
    if (!this.overlay || !this.corner) {
      console.warn('[galerie] TipJar : éléments DOM absents de index.html.');
      this.active = false;
      return;
    }

    this.overlay.querySelector('.tipjar-message').textContent =
      p.message ?? 'Cette galerie vous a plu ? Vous pouvez soutenir son artiste.';
    const btn = this.overlay.querySelector('.tipjar-button');
    btn.textContent = p.buttonLabel ?? "Soutenir l'artiste";
    btn.href = p.url;

    this._onClose = () => this._hide();
    this._onCorner = () => this._show();
    this.overlay.querySelector('.tipjar-close').addEventListener('click', this._onClose);
    this.corner.addEventListener('click', this._onCorner);
    this.corner.title = btn.textContent;
    this.corner.hidden = false;

    // le menu (« Terminer la visite ») ouvre l'écran par cette poignée
    this.app.tipjar = this;
  }

  /**
   * Trois portes, TOUTES atteignables — l'ancienne exigeait d'approcher
   * chacun des cent vingt objets, décor compris : personne ne l'a jamais vue.
   *  1. toutes les ŒUVRES découvertes (Progression : role ≠ decor) ;
   *  2. `minutes` de visite écoulées (défaut 12) — flâner compte aussi ;
   *  3. le bouton « Terminer la visite » du menu (show(), à tout moment).
   */
  update(dt, _ctx) {
    if (!this.active) return;
    if (this.shownOnce) {
      // décompte éventuel avant apparition
      if (this._countdown !== null) {
        this._countdown -= dt;
        if (this._countdown <= 0) {
          this._countdown = null;
          this._show();
        }
      }
      return;
    }
    const prog = this.app.progression;
    const parDecouverte = prog ? prog.complet : this._toutApproche();
    const parDuree = prog && prog.minutes >= (this.params.minutes ?? 12);
    if (parDecouverte || parDuree) {
      this.shownOnce = true;
      this._countdown = this.params.delay ?? 2;
    }
  }

  /** Repli sans Progression (visite audio en repli) : les œuvres seulement. */
  _toutApproche() {
    const radius = this.params.visitRadius ?? 9;
    const oeuvres = this.app.artworks.filter((a) => a.config.role !== 'decor');
    for (const a of oeuvres) {
      if (!this.visited.has(a) && a.distance < radius) {
        this.visited.add(a);
        this.visitedCount++;
      }
    }
    return oeuvres.length > 0 && this.visitedCount >= oeuvres.length;
  }

  /** Ouverture volontaire (bouton du menu) : pas de décompte, pas d'attente. */
  show() {
    this.shownOnce = true;
    this._countdown = null;
    this._show();
  }

  _show() {
    if (this.app.editor?.enabled) return; // pas pendant l'édition
    this.overlay.hidden = false;
  }

  _hide() {
    this.overlay.hidden = true;
  }

  dispose() {
    if (!this.overlay) return;
    this.overlay.querySelector('.tipjar-close')?.removeEventListener('click', this._onClose);
    this.corner?.removeEventListener('click', this._onCorner);
    this.overlay.hidden = true;
    this.corner.hidden = true;
  }
}
