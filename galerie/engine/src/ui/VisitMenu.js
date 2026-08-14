/**
 * Menu de la visite — ouvert par Échap pendant la visite 3D.
 *
 * Sans lui, la visite audio n'était indiquée nulle part une fois entré en
 * 3D : on ne la découvrait que par hasard. Le menu rend visibles les trois
 * choses qu'un visiteur peut vouloir en cours de route : passer en visite
 * audio, revoir les raccourcis clavier, changer de langue (à venir).
 *
 * Mécanique de dialogue identique à la visite audio : role="dialog",
 * aria-modal, tout le reste du document inerte, focus posé sur le premier
 * élément du menu, Tab bouclé, Échap referme. Chargé par import dynamique
 * (main.js) : un visiteur qui n'ouvre jamais le menu n'en télécharge rien.
 *
 * Empilement d'Échap, vu du visiteur : œuvre approchée → recul ; visite 3D
 * libre → CE menu ; menu → fermeture. La visite audio garde sa propre pile
 * (liste → en-tête → sortie) — quand elle est active, le menu ne s'ouvre
 * pas (garde dans main.js).
 */
import { t, lang, setLang, onLangChange } from '../core/i18n.js';

export class VisitMenu {
  constructor(app) {
    this.app = app;
    this.open = false;
    this._inerted = [];
    this._build();
    // Changer de langue depuis le menu le reconstruit dans la langue
    // choisie, focus reposé sur le sélecteur pour ne pas perdre l'utilisateur.
    onLangChange(() => {
      const etaitOuvert = this.open;
      const surLangue = this.el.contains(document.activeElement)
        && document.activeElement.dataset.lang !== undefined;
      if (etaitOuvert) this._releaseDom();
      this.el.remove();
      this._build();
      if (etaitOuvert) {
        this.show();
        if (surLangue) this.el.querySelector(`[data-lang="${lang()}"]`)?.focus();
      }
    });
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'visit-menu';
    el.hidden = true;
    el.innerHTML = `
      <div class="vm-panel" role="dialog" aria-modal="true" aria-label="${t('menu.label')}">
        <h2 id="vm-title">${t('menu.title')}</h2>
        <ul role="list">
          <li><button id="vm-audio">${t('menu.audio')}</button></li>
          <li>
            <button id="vm-keys" aria-expanded="false" aria-controls="vm-keys-help">${t('menu.keys')}</button>
            <div id="vm-keys-help" hidden>
              <p>${t('menu.keys.move')}</p>
              <p>${t('menu.keys.pivot', { pivot: '<span data-keylabel="pivot">A/E ou Q/E</span>' })}</p>
              <p>${t('menu.keys.orbit')}</p>
              <p>${t('menu.keys.focus')}</p>
            </div>
          </li>
        </ul>
        <div class="vm-lang" role="group" aria-label="${t('menu.lang')}">
          <span id="vm-lang-label">${t('menu.lang')}</span>
          <button data-lang="fr" lang="fr" aria-pressed="${lang() === 'fr'}">Français</button>
          <button data-lang="en" lang="en" aria-pressed="${lang() === 'en'}">English</button>
        </div>
        <button id="vm-close">${t('menu.resume')}</button>
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('#vm-close').addEventListener('click', () => this.hide());
    // Chaque bouton porte son propre `lang` : le lecteur d'écran prononce
    // « English » à l'anglaise même quand la page est en français.
    for (const b of el.querySelectorAll('[data-lang]')) {
      b.addEventListener('click', () => setLang(b.dataset.lang));
    }
    el.querySelector('#vm-audio').addEventListener('click', () => this._toAudioTour());
    el.querySelector('#vm-keys').addEventListener('click', (e) => {
      const help = el.querySelector('#vm-keys-help');
      const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
      e.currentTarget.setAttribute('aria-expanded', String(!expanded));
      help.hidden = expanded;
    });

    // Échap referme — et ne remonte pas jusqu'au déclencheur global de
    // main.js, qui rouvrirait le menu dans la foulée.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.hide();
    });

    // Tab bouclé aux extrémités (le reste du document est inerte).
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [...el.querySelectorAll('button')];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.app.controls.suspended = true; // le clavier appartient au menu
    document.getElementById('app')?.setAttribute('aria-hidden', 'true');
    this._inerted = [];
    for (const el of document.body.children) {
      if (el !== this.el && !el.inert) {
        el.inert = true;
        this._inerted.push(el);
      }
    }
    this.el.hidden = false;
    this.el.querySelector('#vm-audio').focus();
    // étiquettes de touches réelles (getLayoutMap) sur l'aide clavier
    this.app.ui?._refineKeyLabels?.();
  }

  /** Rend au document ce que le menu lui avait pris. */
  _releaseDom() {
    this.open = false;
    this.app.controls.suspended = false;
    for (const el of this._inerted) el.inert = false;
    this._inerted = [];
    document.getElementById('app')?.removeAttribute('aria-hidden');
    this.el.hidden = true;
  }

  hide() {
    if (!this.open) return;
    this._releaseDom();
    document.activeElement?.blur?.(); // le clavier retourne à la scène
  }

  async _toAudioTour() {
    this.hide();
    const { mountAudioTour } = await import('./AudioTour.js');
    mountAudioTour(this.app);
  }
}

let instance = null;

/** Point d'entrée unique : ouvre le menu (ou le rend, s'il existe déjà). */
export function mountVisitMenu(app) {
  if (!instance) {
    instance = new VisitMenu(app);
    app.visitMenu = instance;
  }
  instance.show();
  return instance;
}
