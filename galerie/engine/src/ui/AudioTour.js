import { registry } from '../core/ModuleRegistry.js';
import { speakableTitle } from '../core/a11y.js';

/**
 * Visite audio — navigation accessible par-dessus le runtime Visiteur.
 *
 * Ce n'est PAS une application parallèle : c'est une couche de navigation
 * HTML sémantique qui pilote le même moteur que la visite 3D. Approcher une
 * œuvre depuis la liste passe par le MÊME module FocusCamera que le
 * clic-focus : l'auditeur (Web Audio) se déplace vers l'œuvre, les stems se
 * spatialisent, les fondus de pièce existants jouent. Rien n'est dupliqué —
 * si le moteur change, la visite audio suit.
 *
 * Chargé par import dynamique (voir main.js) : un visiteur qui n'ouvre pas
 * la visite audio n'en télécharge pas une ligne.
 *
 * Clavier : Tab entre les zones, flèches dans les listes (tabindex
 * itinérant), Entrée pour approcher, Échap pour reculer — Échap était déjà
 * le geste de recul du mode 3D, FocusCamera l'écoute déjà.
 *
 * Annonces (aria-live) — granularité « standard » : changement de pièce,
 * arrivée sur l'œuvre, recul. La sélection elle-même n'est pas annoncée :
 * c'est le focus qui la porte, le lecteur d'écran lit le bouton (titre) puis
 * sa description (aria-describedby). Les transitions d'état sont OBSERVÉES
 * sur le module FocusCamera plutôt qu'annoncées à l'envoi de la commande :
 * ainsi un recul déclenché par Échap, par le bouton × de la fiche ou par
 * code est annoncé pareil.
 */
export class AudioTour {
  constructor(app) {
    this.app = app;
    this.active = false;
    this._lastFocusState = null;
    this._focusedTitle = '';

    this._prepareArtworks();
    this._build();
    app.onUpdate(() => this._observeFocus());
  }

  /**
   * HRTF par défaut : en visite audio, le rendu binaural est l'image
   * elle-même. Chaque œuvre sonore reçoit un HRTFPanner si elle n'en a pas,
   * et un FocusCamera pour être approchable. Ajoutés AVANT tout chargement
   * audio, ils s'insèrent au moment normal (onAudioReady) — même chemin que
   * s'ils venaient du JSON.
   */
  _prepareArtworks() {
    for (const art of this.app.artworks) {
      const has = (t) => art.modules.some((m) => m.moduleType === t);
      if ((art.config.stems?.length || art.config.videoSound) && !has('HRTFPanner')) {
        const m = registry.create('HRTFPanner', art, { refDistance: 3, maxDistance: 32 }, this.app);
        if (m) { m.init(); art.modules.push(m); if (art.audioReady) m.onAudioReady?.(); }
      }
      if (!has('FocusCamera')) {
        const m = registry.create('FocusCamera', art, { distance: 6 }, this.app);
        if (m) { m.init(); art.modules.push(m); }
      }
    }
  }

  /* --------------------------------------------------------------- DOM --- */

  _build() {
    const el = document.createElement('div');
    el.id = 'audio-tour';
    el.hidden = true;
    el.innerHTML = `
      <div class="at-panel" role="dialog" aria-modal="true" aria-label="Visite audio de la galerie">
        <h2 id="at-title">Visite audio</h2>
        <p id="at-help">Flèches haut et bas pour parcourir, Entrée pour
        approcher une œuvre, Échap pour reculer. Le son est spatialisé :
        un casque restitue la position des œuvres autour de vous.</p>
        <nav aria-label="Pièces de la galerie">
          <h3 id="at-rooms-h">Pièces</h3>
          <ul id="at-rooms" role="list"></ul>
        </nav>
        <nav aria-label="Œuvres de la pièce">
          <h3 id="at-works-h">Œuvres</h3>
          <ul id="at-works" role="list"></ul>
        </nav>
        <button id="at-quit">Quitter la visite audio</button>
        <div id="at-live" aria-live="polite" class="at-sr-only"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.liveEl = el.querySelector('#at-live');

    el.querySelector('#at-quit').addEventListener('click', () => this.stop());

    // Dialogue modal : le focus boucle aux extrémités du panneau. `inert`
    // (posé dans start) empêche déjà d'atteindre la page derrière ; sans ce
    // bouclage, Tab en bout de course partirait dans le chrome du navigateur.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [...el.querySelectorAll('button')]
        .filter((b) => b.tabIndex >= 0 && !b.closest('[hidden]'));
      if (!focusables.length) return;
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

    // flèches = tabindex itinérant, dans chacune des deux listes
    for (const listId of ['at-rooms', 'at-works']) {
      el.querySelector(`#${listId}`).addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = [...e.currentTarget.querySelectorAll('button')];
        const i = items.indexOf(document.activeElement);
        const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        if (next) this._moveFocus(items, next);
      });
    }
  }

  _moveFocus(items, target) {
    for (const b of items) b.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  }

  /* ------------------------------------------------------------- cycle --- */

  start() {
    this.active = true;
    this.app.controls.suspended = true;      // les flèches servent aux listes
    document.getElementById('app')?.setAttribute('aria-hidden', 'true');
    document.getElementById('hint')?.setAttribute('hidden', '');
    // Confinement du focus : tout le reste du document devient inerte
    // (infocusable ET invisible aux lecteurs d'écran). Sans cela, Tab
    // atterrit sur les contrôles invisibles derrière l'overlay — le « × »
    // de la fiche dévoilée à chaque approche, le « ⓘ » des crédits.
    this._inerted = [];
    for (const el of document.body.children) {
      if (el !== this.el && !el.inert) {
        el.inert = true;
        this._inerted.push(el);
      }
    }
    this.el.hidden = false;
    this._renderRooms();
    this._renderWorks();
    this.el.querySelector('#at-works button')?.focus();
    const room = this.app.rooms.current;
    if (room) this._announceRoom(room);
  }

  stop() {
    this.active = false;
    this.app.controls.suspended = false;
    for (const el of this._inerted ?? []) el.inert = false;
    this._inerted = [];
    document.getElementById('app')?.removeAttribute('aria-hidden');
    this.el.hidden = true;

    if (this.app.headless) {
      // Sans rendu, quitter la visite ne mène nulle part : on résout le
      // focus en cours et on rend l'écran de repli, seul point de reprise.
      this.app.activeFocus?.cancel?.();
      const nogl = document.getElementById('nogl');
      const btn = document.getElementById('nogl-audio');
      if (nogl && btn) {
        nogl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Reprendre la visite audio';
        btn.focus();
      }
    } else {
      document.getElementById('hint')?.removeAttribute('hidden');
    }
  }

  /* ------------------------------------------------------------ listes --- */

  _renderRooms() {
    const ul = this.el.querySelector('#at-rooms');
    const rooms = this.app.rooms.list();
    // pièce unique : la navigation par pièces n'apporte rien, on la masque
    ul.closest('nav').hidden = rooms.length < 2;
    ul.innerHTML = '';
    rooms.forEach((room, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = `${room.config.title ?? room.config.id} — ${room.artworks.length} œuvre${room.artworks.length > 1 ? 's' : ''}`;
      b.tabIndex = i === 0 ? 0 : -1;
      b.setAttribute('aria-current', room.isCurrent ? 'true' : 'false');
      b.addEventListener('click', () => this._gotoRoom(room));
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  _renderWorks() {
    const ul = this.el.querySelector('#at-works');
    ul.innerHTML = '';
    const room = this.app.rooms.current;
    const artworks = room ? room.artworks : this.app.artworks;
    artworks.forEach((art, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = speakableTitle(art.config);
      b.tabIndex = i === 0 ? 0 : -1;
      const desc = String(art.config.description ?? '').trim();
      if (desc) {
        const d = document.createElement('span');
        d.id = `at-desc-${art.config.id}`;
        d.className = 'at-desc';
        d.textContent = desc;
        b.setAttribute('aria-describedby', d.id);
        li.append(b, d);
      } else {
        li.appendChild(b);
      }
      b.addEventListener('click', () => this._approach(art));
      ul.appendChild(li);
    });
    if (!artworks.length) {
      ul.innerHTML = '<li class="at-empty">Aucune œuvre dans cette pièce.</li>';
    }
  }

  /* ----------------------------------------------------------- actions --- */

  /**
   * Changement de pièce : les fondus existants du RoomManager jouent.
   * setCurrent résout lui-même un éventuel focus d'œuvre en cours (cancel)
   * et rend false si un fondu est déjà en route — dans ce cas on n'annonce
   * rien : annoncer une pièce dans laquelle on n'est pas entré fausserait
   * le modèle mental de l'utilisateur.
   */
  async _gotoRoom(room) {
    if (room.isCurrent) { this._announceRoom(room); return; }
    const entered = await this.app.rooms.setCurrent(room.config.id);
    if (!entered) return;
    this._renderRooms();
    this._renderWorks();
    this._announceRoom(room);
    this.el.querySelector('#at-works button')?.focus();
  }

  /**
   * Approche : le MÊME chemin que le clic sur l'œuvre en 3D. On cherche le
   * module FocusCamera (garanti par _prepareArtworks) et on le déclenche —
   * caméra, auditeur, spatialisation et fiche suivent d'eux-mêmes.
   */
  _approach(art) {
    if (this.app.activeFocus?.artwork === art) return; // déjà dessus
    this.app.activeFocus?.release();
    const focus = art.modules.find((m) => m.moduleType === 'FocusCamera');
    focus?.focus();
  }

  /* ----------------------------------------------------------- annonces --- */

  _announce(text) {
    // vider puis remplir force la relecture même d'un texte identique
    this.liveEl.textContent = '';
    requestAnimationFrame(() => { this.liveEl.textContent = text; });
  }

  _announceRoom(room) {
    const n = room.artworks.length;
    this._announce(`Pièce ${room.config.title ?? room.config.id}, ${n} œuvre${n > 1 ? 's' : ''}.`);
  }

  /**
   * Observe les transitions du focus plutôt que les commandes : un recul
   * déclenché par Échap, par le × de la fiche ou par un changement de pièce
   * est annoncé exactement pareil.
   */
  _observeFocus() {
    if (!this.active) return;
    const f = this.app.activeFocus;
    const state = f?.state ?? 'idle';
    if (state === 'focused' && this._lastFocusState !== 'focused') {
      this._focusedTitle = speakableTitle(f.artwork.config);
      this._announce(`${this._focusedTitle}, approché.`);
    } else if (state === 'out' && (this._lastFocusState === 'focused' || this._lastFocusState === 'in')) {
      this._announce('Reculé.');
    }
    this._lastFocusState = state;
  }
}

let instance = null;

/** Point d'entrée unique (même motif que l'éditeur). */
export function mountAudioTour(app) {
  if (!instance) {
    instance = new AudioTour(app);
    app.audioTour = instance;
  }
  instance.start();
  return instance;
}
