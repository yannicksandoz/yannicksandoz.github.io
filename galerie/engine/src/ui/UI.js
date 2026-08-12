import { collectCredits } from '../core/credits.js';

/**
 * Interface DOM : écran d'accueil (chargement + déblocage AudioContext),
 * fiche d'œuvre du module FocusCamera, indice de navigation, aide tactile
 * au premier lancement, écran de crédits.
 */
export class UI {
  constructor() {
    this.enterScreen = document.getElementById('enter-screen');
    this.enterBtn = document.getElementById('enter-btn');
    this.loadBar = document.getElementById('load-bar');
    this.loadBarFill = this.loadBar?.querySelector('i');
    this.focusOverlay = document.getElementById('focus-overlay');
    this.focusTitle = document.getElementById('focus-title');
    this.focusDesc = document.getElementById('focus-desc');
    this.focusClose = document.getElementById('focus-close');
    this.hint = document.getElementById('hint');
    this.touchHint = document.getElementById('touch-hint');
    this._onCloseFocus = null;

    this.focusClose.addEventListener('click', () => this._onCloseFocus?.());
  }

  /** Branche la barre de progression sur le LoadingTracker de l'App. */
  bindLoading(tracker) {
    tracker.onChange((done, total) => {
      if (!this.loadBarFill) return;
      const pct = total > 0 ? Math.round((done / total) * 100) : 100;
      this.loadBarFill.style.width = `${pct}%`;
      if (total > 0 && done >= total) {
        this.loadBar.classList.add('complete');
      } else {
        this.loadBar.classList.remove('complete');
      }
    });
  }

  /** Le bouton « Entrer » reste désactivé tant que la config n'est pas lue. */
  setReady() {
    this.enterBtn.disabled = false;
    this.enterBtn.textContent = 'Entrer';
  }

  showLoadError(message) {
    const sub = this.enterScreen.querySelector('.sub');
    if (sub) sub.textContent = message;
  }

  /** Résout quand l'utilisateur clique sur « Entrer ». */
  waitForEnter() {
    return new Promise((resolve) => {
      this.enterBtn.addEventListener('click', () => {
        this.enterScreen.classList.add('leaving');
        setTimeout(() => { this.enterScreen.remove(); }, 1300);
        this.hint.hidden = false;
        resolve();
      }, { once: true });
    });
  }

  /** Aide tactile éphémère, montrée une seule fois par appareil. */
  maybeShowTouchHint(isMobile) {
    if (!isMobile || !this.touchHint) return;
    try {
      if (localStorage.getItem('galerie-touch-hint')) return;
      localStorage.setItem('galerie-touch-hint', '1');
    } catch { /* stockage indisponible : on montre quand même */ }
    this.touchHint.hidden = false;
    setTimeout(() => {
      this.touchHint.classList.add('leaving');
      setTimeout(() => this.touchHint.remove(), 900);
    }, 6000);
  }

  showFocus(artwork, onClose) {
    this._onCloseFocus = onClose;
    this.focusTitle.textContent = artwork.config.title ?? artwork.config.id;
    this.focusDesc.textContent = artwork.config.description ?? '';
    this.focusOverlay.hidden = false;
  }

  hideFocus() {
    this.focusOverlay.hidden = true;
    this._onCloseFocus = null;
  }

  /**
   * Écran de crédits.
   *
   * Une licence CC-BY oblige à citer l'auteur, et cette obligation ne doit
   * pas dépendre de la mémoire de qui compose la scène : le crédit voyage
   * avec l'objet depuis la bibliothèque, et cet écran le publie. Le bouton
   * n'apparaît que s'il y a effectivement quelque chose à citer — une scène
   * entièrement personnelle ne s'encombre de rien.
   */
  setCredits(works) {
    const corner = document.getElementById('credits-corner');
    const overlay = document.getElementById('credits-overlay');
    const list = document.getElementById('credits-list');
    if (!corner || !overlay || !list) return;

    const credits = collectCredits(works);
    corner.hidden = credits.length === 0;
    if (!credits.length) { overlay.hidden = true; return; }

    list.innerHTML = credits.map((c) => {
      const who = esc(c.author || 'auteur non précisé');
      const name = c.sourceUrl
        ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${who}</a>`
        : who;
      return `<p><b>${name}</b>${c.license ? ` — ${esc(c.license)}` : ''}
        <br><span class="muted">${esc(c.titles.join(', '))}</span></p>`;
    }).join('');

    if (this._creditsWired) return;
    this._creditsWired = true;
    corner.addEventListener('click', () => { overlay.hidden = false; });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-credits-close]')) {
        overlay.hidden = true;
      }
    });
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
