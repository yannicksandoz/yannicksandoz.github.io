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
import { fpsMeterEnabled, setFpsMeter } from './FpsMeter.js';

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
    // La liste des pièces vient de la configuration chargée : le menu EST
    // le plan de la galerie — on saute où l'on veut, sans marcher.
    const pieces = [...(this.app.rooms?.rooms?.values() ?? [])]
      .map((r) => `<li><button data-room="${r.config.id}"
        ${r === this.app.rooms.current ? 'aria-current="true"' : ''}>
        ${esc(r.config.title ?? r.config.id)}</button></li>`).join('');
    const pleinEcranDispo = Boolean(document.fullscreenEnabled);
    el.innerHTML = `
      <div class="vm-panel" role="dialog" aria-modal="true" aria-label="${t('menu.label')}">
        <h2 id="vm-title">${t('menu.title')}</h2>
        <ul role="list">
          <li><button id="vm-derive">${t('menu.derive')}</button></li>
          <li><button id="vm-audio">${t('menu.audio')}</button></li>
          <li>
            <button id="vm-rooms" aria-expanded="false" aria-controls="vm-rooms-list">${t('menu.rooms')}</button>
            <ul id="vm-rooms-list" class="vm-rooms" role="list" hidden>${pieces}</ul>
          </li>
          <li>
            <button id="vm-keys" aria-expanded="false" aria-controls="vm-keys-help">${t('menu.keys')}</button>
            <div id="vm-keys-help" hidden>
              <p>${t('menu.keys.move')}</p>
              <p>${t('menu.keys.pivot', { pivot: '<span data-keylabel="pivot">A/E ou Q/E</span>' })}</p>
              <p>${t('menu.keys.orbit')}</p>
              <p>${t('menu.keys.focus')}</p>
            </div>
          </li>
          <li><button id="vm-share">${t('menu.share')}</button></li>
          ${pleinEcranDispo ? `<li><button id="vm-fullscreen">${document.fullscreenElement ? t('menu.fullscreen.exit') : t('menu.fullscreen')}</button></li>` : ''}
          <li><a id="vm-liste" href="liste.html">${t('menu.liste')}</a></li>
          <li>
            <button id="vm-settings" aria-expanded="false" aria-controls="vm-settings-panel">${t('menu.settings')}</button>
            <div id="vm-settings-panel" hidden>
              <p class="vm-subhead">${t('menu.settings.dev')}</p>
              <label class="vm-check">
                <input type="checkbox" id="vm-fps" ${fpsMeterEnabled() ? 'checked' : ''}>
                ${t('menu.settings.fps')}
              </label>
            </div>
          </li>
          ${this.app.tipjar ? `<li><button id="vm-finish">${t('menu.finish')}</button></li>` : ''}
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
    // même pli accordéon pour les pièces, le clavier et les réglages
    for (const [btn, panel] of [['#vm-rooms', '#vm-rooms-list'],
      ['#vm-keys', '#vm-keys-help'], ['#vm-settings', '#vm-settings-panel']]) {
      el.querySelector(btn).addEventListener('click', (e) => {
        const help = el.querySelector(panel);
        const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
        e.currentTarget.setAttribute('aria-expanded', String(!expanded));
        help.hidden = expanded;
      });
    }
    el.querySelector('#vm-fps').addEventListener('change', (e) => {
      setFpsMeter(this.app, e.currentTarget.checked);
    });

    // sauter dans une pièce : fondu de transition habituel, menu refermé
    for (const b of el.querySelectorAll('[data-room]')) {
      b.addEventListener('click', () => {
        this.hide();
        this.app.derive?.arreter?.();
        this.app.activeFocus?.release?.();
        this.app.rooms.setCurrent(b.dataset.room);
      });
    }

    // « Laisse-toi porter » : la dérive démarre, le menu s'efface
    el.querySelector('#vm-derive').addEventListener('click', async () => {
      this.hide();
      const { mountDerive } = await import('../core/Derive.js');
      mountDerive(this.app).demarrer();
    });

    // Partager : l'API native quand elle existe (mobile), sinon copie du
    // lien — avec la pièce courante dans l'URL, pour arriver au même endroit.
    el.querySelector('#vm-share').addEventListener('click', async (e) => {
      const url = this._lienProfond();
      const bouton = e.currentTarget;
      try {
        if (navigator.share) {
          await navigator.share({ title: document.title, url });
        } else {
          await navigator.clipboard.writeText(url);
          const avant = bouton.textContent;
          bouton.textContent = t('menu.share.copied');
          setTimeout(() => { bouton.textContent = avant; }, 1800);
        }
      } catch { /* partage annulé : rien à faire */ }
    });

    // Plein écran (absent quand l'API n'existe pas — iPhone)
    el.querySelector('#vm-fullscreen')?.addEventListener('click', async (e) => {
      const bouton = e.currentTarget;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          bouton.textContent = t('menu.fullscreen');
        } else {
          await document.documentElement.requestFullscreen();
          bouton.textContent = t('menu.fullscreen.exit');
        }
      } catch { /* refusé par le navigateur : le bouton reste */ }
    });

    // Terminer la visite : le chapeau de fin, sans condition
    el.querySelector('#vm-finish')?.addEventListener('click', () => {
      this.hide();
      this.app.tipjar?.show();
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
      const focusables = [...el.querySelectorAll('button, input, a[href]')]
        .filter((f) => f.offsetParent !== null); // pas les panneaux repliés
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
    // Reconstruit à chaque ouverture : la pièce courante (aria-current),
    // l'état du plein écran et la présence du « Terminer la visite »
    // (le module TipJar s'enregistre après le premier rendu) bougent.
    this.el.remove();
    this._build();
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
    this.el.querySelector('#vm-derive').focus();
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

  /**
   * Lien profond vers l'endroit où l'on est : ?room=pièce (et ?work=œuvre
   * si l'on est devant une fiche). Celui qui l'ouvre arrive au même point.
   */
  _lienProfond() {
    const url = new URL(window.location.href);
    url.search = '';
    const room = this.app.rooms?.current?.config.id;
    if (room) url.searchParams.set('room', room);
    const oeuvre = this.app.activeFocus?.artwork?.config.id;
    if (oeuvre) url.searchParams.set('work', oeuvre);
    return url.toString();
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
