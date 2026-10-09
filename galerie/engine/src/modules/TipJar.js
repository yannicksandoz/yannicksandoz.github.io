import { Module } from './Module.js';
import { porteDuChapeau } from './chapeau-regles.js';
import { t } from '../core/i18n.js';

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
 *  - message     (défaut fourni) : texte de l'écran de fin, quand tout est découvert
 *  - messageDuree (défaut : la phrase neutre de l'interface) : texte des autres
 *                portes (douze minutes, « Terminer la visite »)
 *  - buttonLabel (défaut « Soutenir l'artiste »)
 *  - visitRadius (défaut 9) : distance à laquelle une œuvre compte comme « visitée »
 *  - minutes     (défaut 12) : minutes de visite après lesquelles l'écran vient de lui-même
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

    // l'adresse du chapeau vient du contenu : le web seulement, jamais un
    // `javascript:` qui s'exécuterait au clic (même règle que `link`)
    if (!/^https?:\/\//i.test(String(p.url ?? ''))) {
      console.warn('[galerie] TipJar : adresse refusée (http(s) seulement).');
      this.active = false;
      return;
    }
    this.overlay.querySelector('.tipjar-message').textContent = p.message ?? t('tipjar.message.fin');
    const btn = this.overlay.querySelector('.tipjar-button');
    btn.textContent = p.buttonLabel ?? t('tipjar.support');
    btn.href = p.url;

    this._onClose = () => this._hide();
    this._onCorner = () => this._show();
    this.overlay.querySelector('.tipjar-close').addEventListener('click', this._onClose);
    this.corner.addEventListener('click', this._onCorner);
    this.corner.title = btn.textContent;
    this.corner.hidden = false;

    // le menu (« Terminer la visite ») ouvre l'écran par cette poignée
    this.app.tipjar = this;
    // L'OBSERVATION SUIT LA BOUCLE DE L'APP, pas celle de l'œuvre : une
    // œuvre ne reçoit `update` que dans sa propre pièce (Artwork.update),
    // et le chapeau, posé sur le monolithe, ne regardait que le labo — la
    // porte « tout découvert » ne s'ouvrait qu'à qui y repassait après sa
    // dernière découverte, et « douze minutes » tombait deux secondes
    // après avoir poussé sa porte, quoi qu'on ait vu.
    this._off = this.app.onUpdate?.((dt) => this._observer(dt));
  }

  /**
   * Trois portes, TOUTES atteignables — l'ancienne exigeait d'approcher
   * chacun des cent vingt objets, décor compris : personne ne l'a jamais vue.
   *  1. toutes les ŒUVRES découvertes par cette visite (Progression) ;
   *  2. `minutes` de visite écoulées (défaut 12) — flâner compte aussi,
   *     mais pas pendant la visite guidée, qu'on n'interrompt pas ;
   *  3. le bouton « Terminer la visite » du menu (show(), à tout moment).
   * La règle est pure (chapeau-regles.js) ; ici, la boucle et le décompte.
   */
  update(_dt, _ctx) {
    // rien : l'observation est sur la boucle de l'app (voir init)
  }

  _observer(dt) {
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
    const porte = prog
      ? porteDuChapeau({ complet: prog.complet, nouvelles: prog.nouvelles, minutes: prog.minutes,
        seuil: this.params.minutes ?? 12, deriveActive: Boolean(this.app.derive?.active) })
      : (this._toutApproche() ? 'decouverte' : null);
    if (porte) {
      this.shownOnce = true;
      this._raison = porte;
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
    this._raison = 'fin';
    this._show();
  }

  _show() {
    if (this.app.editor?.enabled) return; // pas pendant l'édition
    // LE MOT JUSTE : `message` (le contenu) est écrit pour la fin d'un tour
    // complet — « vous avez fait le tour » — et mentirait à qui a flâné
    // douze minutes ou terminé de lui-même après deux œuvres ; ces deux
    // portes prennent `messageDuree`, ou la phrase neutre de l'interface
    const p = this.params;
    const texte = this._raison === 'decouverte'
      ? (p.message ?? t('tipjar.message.fin'))
      : (p.messageDuree ?? t('tipjar.message.fin'));
    this.overlay.querySelector('.tipjar-message').textContent = texte;
    this.overlay.hidden = false;
  }

  _hide() {
    this.overlay.hidden = true;
  }

  dispose() {
    this._off?.();
    if (!this.overlay) return;
    this.overlay.querySelector('.tipjar-close')?.removeEventListener('click', this._onClose);
    this.corner?.removeEventListener('click', this._onCorner);
    this.overlay.hidden = true;
    this.corner.hidden = true;
  }
}
