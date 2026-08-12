import { collectCredits, collectSources } from '../core/credits.js';

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
    this._refineKeyLabels();
  }

  /**
   * Remplace les étiquettes de touches par celles du clavier RÉEL.
   *
   * Les raccourcis sont liés aux touches physiques (`e.code`), mais
   * l'utilisateur lit des étiquettes : sur un AZERTY, la touche physique
   * KeyQ s'appelle « A ». `getLayoutMap()` (Chrome/Edge) donne la
   * correspondance ; ailleurs, les textes statiques restent — ils couvrent
   * déjà les deux dispositions courantes (« A/E ou Q/E »).
   */
  async _refineKeyLabels() {
    try {
      const map = await navigator.keyboard?.getLayoutMap?.();
      if (!map) return;
      const of = (code, fallback) => (map.get(code) || fallback).toUpperCase();
      document.querySelectorAll('[data-keylabel="pivot"]').forEach((el) => {
        el.textContent = `${of('KeyQ', 'Q')}/${of('KeyE', 'E')}`;
      });
      document.querySelectorAll('[data-keylabel="edit"]').forEach((el) => {
        el.textContent = of('Backquote', '²');
      });
    } catch { /* pas de carte de layout : les libellés neutres suffisent */ }
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
    document.getElementById('enter-audio')?.removeAttribute('aria-disabled');
  }

  showLoadError(message) {
    const sub = this.enterScreen.querySelector('.sub');
    if (sub) sub.textContent = message;
  }

  /**
   * Résout quand l'utilisateur choisit son mode d'entrée :
   * { audioTour: false } — visite 3D (bouton « Entrer ») ;
   * { audioTour: true }  — visite audio accessible.
   *
   * Les deux gestes débloquent l'AudioContext (l'appelant s'en charge).
   * Le lien audio est PREMIER dans l'ordre de tabulation (premier focusable
   * du document) : un utilisateur de lecteur d'écran le rencontre avant
   * tout le reste. Il reste inerte tant que la configuration charge — même
   * garde que le bouton Entrer, mais sans `disabled`, qui le rendrait
   * infocusable.
   */
  waitForEnter() {
    return new Promise((resolve) => {
      const leave = (audioTour) => {
        this.enterScreen.classList.add('leaving');
        setTimeout(() => { this.enterScreen.remove(); }, 1300);
        if (!audioTour) this.hint.hidden = false;
        resolve({ audioTour });
      };
      this.enterBtn.addEventListener('click', () => leave(false), { once: true });
      const audioBtn = document.getElementById('enter-audio');
      audioBtn?.addEventListener('click', () => {
        if (this.enterBtn.disabled) return; // configuration pas encore lue
        leave(true);
      });
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
    const sources = collectSources(works);
    corner.hidden = credits.length === 0 && sources.length === 0;
    if (corner.hidden) { overlay.hidden = true; return; }

    list.innerHTML = sources.map(mentionSource).join('') + credits.map((c) => {
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

/**
 * Mention obligatoire d'une plateforme source.
 *
 * Poly Pizza demande une mention nommée avec lien vers le service, en plus
 * de l'attribution de chaque auteur. C'est une condition d'usage, pas une
 * politesse : elle s'affiche dès qu'un modèle en vient, et rien ne permet
 * de la retirer.
 */
const PLATEFORMES = {
  polypizza: { label: 'Modèles fournis par Poly Pizza', url: 'https://poly.pizza' }
};

function mentionSource(source) {
  const p = PLATEFORMES[source];
  if (!p) return '';
  return `<p class="credits-source"><a href="${esc(p.url)}" target="_blank"
    rel="noopener noreferrer">${esc(p.label)}</a></p>`;
}
