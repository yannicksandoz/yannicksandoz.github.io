/**
 * Interface DOM : écran d'accueil (déblocage AudioContext), fiche d'œuvre
 * du module FocusCamera, indice de navigation.
 */
export class UI {
  constructor() {
    this.enterScreen = document.getElementById('enter-screen');
    this.enterBtn = document.getElementById('enter-btn');
    this.focusOverlay = document.getElementById('focus-overlay');
    this.focusTitle = document.getElementById('focus-title');
    this.focusDesc = document.getElementById('focus-desc');
    this.focusClose = document.getElementById('focus-close');
    this.hint = document.getElementById('hint');
    this._onCloseFocus = null;

    this.focusClose.addEventListener('click', () => this._onCloseFocus?.());
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
}
