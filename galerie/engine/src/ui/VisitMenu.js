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
import { peindreLibelles } from '../core/clavier.js';
import { t, lang, setLang, onLangChange } from '../core/i18n.js';
import { fpsMeterEnabled, setFpsMeter } from './FpsMeter.js';
import { minimapActive, setMinimap, mountCartePleine } from './Carte.js';
import { recommencerLaVisite } from '../core/Memoire.js';

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
    // La section « Pièces » EST la carte : un plan dessiné au fil de la
    // visite, et sous lui la liste de ce qu'on a vu — on y saute d'un clic.
    //
    // Les pièces jamais visitées y figurent en « ??? », non cliquables. La
    // liste montrait autrefois toute la galerie, noms compris, dès la
    // première seconde : elle vendait ce que la carte ménage, et l'une des
    // deux mentait forcément. C'est la liste qui a cédé — on garde le
    // plaisir de trouver, et le catalogue ◈ reste l'autre chemin.
    const memoire = this.app.memoire;
    const vues = memoire?.pieces ?? null;
    const courante = this.app.rooms?.current?.config.id;
    const toutes = [...(this.app.rooms?.rooms?.values() ?? [])];
    const connues = toutes.filter(
      (r) => !vues || vues.has(r.config.id) || r.config.id === courante);
    // Le reste tient sur UNE ligne : quatorze « ? ? ? » alignés donnaient
    // une liste plus longue que la galerie, et ne disaient rien de plus que
    // le nombre — qui, lui, se dit en une phrase.
    const reste = toutes.length - connues.length;
    const pieces = connues.map((r) => {
      const id = r.config.id;
      return `<li><button data-room="${esc(id)}"
        ${id === courante ? 'aria-current="true"' : ''}>
        ${esc(r.config.title ?? id)}</button></li>`;
    }).join('') + (reste > 0
      ? `<li><span class="vm-inconnue">${t('menu.rooms.left', { n: reste })}</span></li>`
      : '');
    // Le plan ne tient plus ici : il s'ouvre en grand, sur toute la page
    // (voir `CartePleine`). Le menu garde la LISTE — c'est elle le chemin
    // clavier et lecteur d'écran, et elle dit la même mémoire.
    const pleinEcranDispo = Boolean(document.fullscreenEnabled);
    el.innerHTML = `
      <div class="vm-panel" role="dialog" aria-modal="true" aria-label="${t('menu.label')}">
        <h2 id="vm-title">${t('menu.title')}</h2>
        <button id="vm-x" class="vm-x" aria-label="${t('menu.resume')}"
          title="${t('menu.resume')}">✕</button>
        <p class="vm-groupe" id="vm-g-visite">${t('menu.groupe.visite')}</p>
        <ul role="list" aria-labelledby="vm-g-visite">
          <li><button id="vm-derive">${t('menu.derive')}</button></li>
          <li><button id="vm-audio">${t('menu.audio')}</button></li>
          <li>
            <button id="vm-rooms" aria-expanded="false" aria-controls="vm-rooms-list">${t('menu.rooms')}</button>
            <div id="vm-rooms-list" hidden>
              <button id="vm-plan" class="vm-plan">${t('carte.ouvrir')}</button>
              <p class="vm-carte-note">${t('menu.map.note')}</p>
              <ul class="vm-rooms" role="list">${pieces}</ul>
            </div>
          </li>
          <li><a id="vm-liste" href="liste.html">${t('menu.liste')}</a></li>
          <li><button id="vm-share">${t('menu.share')}</button></li>
          ${this.app.tipjar ? `<li><button id="vm-finish">${t('menu.finish')}</button></li>` : ''}
        </ul>
        <p class="vm-groupe" id="vm-g-affichage">${t('menu.groupe.affichage')}</p>
        <ul role="list" aria-labelledby="vm-g-affichage">
          ${pleinEcranDispo ? `<li><button id="vm-fullscreen">${document.fullscreenElement ? t('menu.fullscreen.exit') : t('menu.fullscreen')}</button></li>` : ''}
          <li>
            <label class="vm-check">
              <input type="checkbox" id="vm-minimap" ${minimapActive() ? 'checked' : ''}>
              ${t('menu.settings.minimap')}
            </label>
          </li>
          <li>
            <div class="vm-lang" role="group" aria-label="${t('menu.lang')}">
              <span id="vm-lang-label">${t('menu.lang')}</span>
              <button data-lang="fr" lang="fr" aria-pressed="${lang() === 'fr'}">Français</button>
              <button data-lang="en" lang="en" aria-pressed="${lang() === 'en'}">English</button>
            </div>
          </li>
        </ul>
        <p class="vm-groupe" id="vm-g-systeme">${t('menu.groupe.systeme')}</p>
        <ul role="list" aria-labelledby="vm-g-systeme">
          <li>
            <button id="vm-keys" aria-expanded="false" aria-controls="vm-keys-help">${t('menu.keys')}</button>
            <div id="vm-keys-help" hidden>
              <p>${t('menu.keys.move', { move: '<span data-keylabel="move">ZQSD / WASD</span>' })}</p>
              <p>${t('menu.keys.pivot', { pivot: '<span data-keylabel="pivot">A/E ou Q/E</span>' })}</p>
              <p>${t('menu.keys.orbit')}</p>
              <p>${t('menu.keys.focus')}</p>
            </div>
          </li>
          <li>
            <button id="vm-memoire" aria-expanded="false" aria-controls="vm-memoire-panel">${t('menu.settings.memory')}</button>
            <div id="vm-memoire-panel" hidden>
              <p class="vm-note">${t('menu.settings.memory.note')}</p>
              <button id="vm-forget" class="vm-danger">${t('menu.settings.forget')}</button>
            </div>
          </li>
          <li>
            <label class="vm-check">
              <input type="checkbox" id="vm-fps" ${fpsMeterEnabled() ? 'checked' : ''}>
              ${t('menu.settings.fps')}
            </label>
          </li>
        </ul>
        <button id="vm-close">${t('menu.resume')}</button>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    // Le menu naît après l'écran d'accueil : ses étiquettes de touches
    // n'avaient jamais été repeintes, et le menu restait le seul endroit à
    // annoncer des touches qui ne sont pas celles du clavier de la personne.
    peindreLibelles(el);

    el.querySelector('#vm-close').addEventListener('click', () => this.hide());
    // la croix en haut : le geste de fermeture universel, là où la main le
    // cherche — le bouton « Reprendre la visite » du bas reste, pour la
    // navigation clavier et pour qui lit le menu jusqu'au bout
    el.querySelector('#vm-x').addEventListener('click', () => this.hide());
    // Chaque bouton porte son propre `lang` : le lecteur d'écran prononce
    // « English » à l'anglaise même quand la page est en français.
    for (const b of el.querySelectorAll('[data-lang]')) {
      b.addEventListener('click', () => setLang(b.dataset.lang));
    }
    el.querySelector('#vm-audio').addEventListener('click', () => this._toAudioTour());
    // même pli accordéon pour les pièces, le clavier et la mémoire
    for (const [btn, panel] of [['#vm-rooms', '#vm-rooms-list'],
      ['#vm-keys', '#vm-keys-help'], ['#vm-memoire', '#vm-memoire-panel']]) {
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
    el.querySelector('#vm-minimap').addEventListener('change', (e) => {
      setMinimap(this.app, e.currentTarget.checked);
    });

    // Recommencer : la seule porte de sortie d'une mémoire qui persiste.
    // Deux clics — le premier demande, le second efface. Un geste unique
    // sur un bouton qu'on ne peut plus annuler serait un piège.
    el.querySelector('#vm-forget').addEventListener('click', (e) => {
      const bouton = e.currentTarget;
      if (bouton.dataset.sur !== '1') {
        bouton.dataset.sur = '1';
        bouton.textContent = t('menu.settings.forget.sure');
        setTimeout(() => {
          if (!bouton.isConnected || bouton.dataset.sur !== '1') return;
          bouton.dataset.sur = '';
          bouton.textContent = t('menu.settings.forget');
        }, 5000);
        return;
      }
      recommencerLaVisite(this.app);
      bouton.dataset.sur = '';
      bouton.textContent = t('menu.settings.forget.done');
      bouton.disabled = true;
    });

    // « Voir le plan en grand » : le menu s'efface, le plan prend la page.
    el.querySelector('#vm-plan')?.addEventListener('click', () => {
      this.hide();
      mountCartePleine(this.app).ouvrir();
    });

    // sauter dans une pièce : fondu de transition habituel, menu refermé
    for (const b of el.querySelectorAll('[data-room]')) {
      b.addEventListener('click', () => this._allerA(b.dataset.room));
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

  /** Sauter dans une pièce, depuis la liste comme depuis la carte. */
  _allerA(id) {
    if (!id) return;
    this.hide();
    this.app.derive?.arreter?.();
    this.app.activeFocus?.release?.();
    this.app.rooms.setCurrent(id);
  }

  /** Ouvre le menu directement sur la carte (clic sur la minimap). */
  ouvrirPieces() {
    this.show();
    const bouton = this.el.querySelector('#vm-rooms');
    if (!bouton) return;
    bouton.setAttribute('aria-expanded', 'true');
    this.el.querySelector('#vm-rooms-list').hidden = false;
    bouton.focus();
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
