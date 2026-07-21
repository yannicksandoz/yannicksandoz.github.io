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
  }

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
    const radius = this.params.visitRadius ?? 9;
    for (const a of this.app.artworks) {
      if (!this.visited.has(a) && a.distance < radius) {
        this.visited.add(a);
        this.visitedCount++;
      }
    }
    if (this.visitedCount >= this.app.artworks.length && this.app.artworks.length > 0) {
      this.shownOnce = true;
      this._countdown = this.params.delay ?? 2;
    }
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
