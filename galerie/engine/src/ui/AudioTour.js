import * as THREE from 'three';
import { registry } from '../core/ModuleRegistry.js';
import { speakableTitle } from '../core/a11y.js';
import { easeInOutCubic } from '../core/utils.js';

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
 * Clavier — une seule liste, testée avec VoiceOver : haut/bas parcourt les
 * œuvres (tabindex itinérant, le son glisse de l'une à l'autre),
 * gauche/droite change de pièce, Entrée approche, Échap remonte (recul,
 * puis bouton Quitter). Tab n'a que deux arrêts : la liste et Quitter.
 * Quitter ramène à l'accueil.
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
    this._glide = null; // pré-écoute : point vers lequel l'auditeur glisse

    this._prepareArtworks();
    this._build();
    app.onUpdate((dt) => {
      this._observeFocus();
      this._glideStep(dt);
    });
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
      <div class="at-panel" role="dialog" aria-modal="true"
           aria-label="Visite audio de la galerie">
        <!-- Point d'accueil de la visite : le focus se pose sur cet en-tête
             (tabindex -1) et le lecteur d'écran lit « Visite audio » PUIS
             l'explication (aria-describedby) — jamais une œuvre en premier.
             Échap depuis la liste y ramène (l'explication est relue). -->
        <h2 id="at-title" tabindex="-1" aria-describedby="at-help">Visite audio</h2>
        <!-- repère visuel de la pièce courante ; le lecteur d'écran, lui,
             la reçoit par les annonces — pas deux fois -->
        <p id="at-room" aria-hidden="true"></p>
        <!-- aria-describedby de l'en-tête : lu à l'arrivée, télégraphique
             à dessein — chaque mot en plus est du temps volé au son. -->
        <p id="at-help">Haut et bas : œuvres. Gauche et droite : pièces.
        Entrée : approcher. Échap : revenir. Casque recommandé.</p>
        <ul id="at-works" role="list" aria-label="Œuvres"></ul>
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
      if (document.activeElement === el.querySelector('#at-title')) {
        // depuis l'en-tête d'accueil : Tab entre, Maj+Tab entre par la fin
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Échap remonte, étage par étage : œuvre approchée → recul (géré par
    // FocusCamera, au niveau window) ; liste → en-tête d'accueil de la
    // visite (l'explication est relue) ; en-tête ou ailleurs → sortie de
    // la visite, retour à l'accueil.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.app.activeFocus) return;
      if (el.querySelector('#at-works').contains(document.activeElement)) {
        el.querySelector('#at-title').focus();
      } else {
        this.stop();
      }
    });

    // La liste unique : haut/bas parcourt les œuvres (tabindex itinérant),
    // gauche/droite change de pièce. Le focus initial étant sur l'en-tête
    // (le temps que l'explication soit lue), la première flèche y descend.
    el.addEventListener('keydown', (e) => {
      const works = el.querySelector('#at-works');
      const inList = works.contains(document.activeElement);
      const onPanel = document.activeElement === el.querySelector('#at-title');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!inList && !onPanel) return;
        e.preventDefault();
        const items = [...works.querySelectorAll('button')];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const next = i === -1
          ? items[0] // depuis le dialogue : on entre dans la liste
          : items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        this._moveFocus(items, next);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!inList && !onPanel) return;
        e.preventDefault();
        this._stepRoom(e.key === 'ArrowRight' ? 1 : -1);
      }
    });
  }

  _moveFocus(items, target) {
    for (const b of items) b.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  }

  /* ------------------------------------------------------------- cycle --- */

  start() {
    this.active = true;
    this.app.controls.suspended = true;      // les flèches servent à la liste
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
    this._renderWorks();
    this._updateRoomLabel();
    // Le focus se pose sur l'en-tête : le lecteur d'écran lit « Visite
    // audio » puis l'explication des contrôles AVANT toute œuvre. Flèche
    // bas ou Tab pour entrer dans la liste.
    this.el.querySelector('#at-title').focus();
    const room = this.app.rooms.current;
    if (room) this._announceRoom(room);
  }

  /** Quitter ramène à l'accueil — pas à la 3D : état neuf, deux boutons. */
  stop() {
    if (!this.app.headless) {
      location.reload();
      return;
    }

    // Sans rendu il n'y a pas d'accueil complet à recharger : on rend
    // l'écran de repli #nogl — c'est lui, l'accueil de ce mode — sans
    // reconstruire le moteur déjà chargé.
    this.active = false;
    this._glide = null;
    this.app.controls.suspended = false;
    for (const el of this._inerted ?? []) el.inert = false;
    this._inerted = [];
    document.getElementById('app')?.removeAttribute('aria-hidden');
    this.el.hidden = true;
    this.app.activeFocus?.cancel?.();
    const nogl = document.getElementById('nogl');
    const btn = document.getElementById('nogl-audio');
    if (nogl && btn) {
      nogl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Reprendre la visite audio';
      btn.focus();
    }
  }

  /* ------------------------------------------------------------ listes --- */

  _updateRoomLabel() {
    const label = this.el.querySelector('#at-room');
    const rooms = this.app.rooms.list();
    const cur = this.app.rooms.current;
    if (!cur || rooms.length < 2) {
      label.hidden = true;
      return;
    }
    const i = rooms.indexOf(cur);
    label.hidden = false;
    label.textContent = `Pièce ${i + 1}/${rooms.length} — ${cur.config.title ?? cur.config.id}`;
  }

  _renderWorks() {
    const ul = this.el.querySelector('#at-works');
    ul.innerHTML = '';
    const room = this.app.rooms.current;
    const artworks = room ? room.artworks : this.app.artworks;
    artworks.forEach((art, i) => {
      // Titre seul, volontairement : en parcourant, le lecteur d'écran dit
      // le nom puis SE TAIT — c'est le son qui parle. La description n'est
      // lue qu'à l'approche (Entrée), dans l'annonce.
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = speakableTitle(art.config);
      b.tabIndex = i === 0 ? 0 : -1;
      li.appendChild(b);
      b.addEventListener('click', () => this._approach(art));
      b.addEventListener('focus', () => this._audition(art));
      ul.appendChild(li);
    });
    if (!artworks.length) {
      ul.innerHTML = '<li class="at-empty">Aucune œuvre dans cette pièce.</li>';
    }
  }

  /* ------------------------------------------------------- pré-écoute --- */

  /**
   * Parcourir la liste fait glisser l'auditeur d'œuvre en œuvre : le fondu
   * enchaîné est celui, naturel, de la spatialisation — comme survoler un
   * menu dont chaque entrée fait monter son propre son. Désactivable par
   * `"audition": false` sur une œuvre ou sur sa pièce (certaines musiques
   * ne supportent pas d'être fondues).
   */
  _audition(art) {
    if (this.app.activeFocus) return; // une approche est en cours : elle prime
    if (art.config.audition === false) return;
    if (art.room?.config.audition === false) return;
    const g = art.group;
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    const pos = g.position.clone().addScaledVector(dir, 7);
    pos.y = g.position.y;
    this._glide = {
      pts: [this.app.camera.position.clone(), pos],
      tgts: [this.app.controls.orbit.target.clone(), g.position.clone()],
      t: 0,
      dur: this.app.quality.reducedMotion ? 0.4 : 1.6
    };
  }

  /**
   * Cadence du trajet, en trois temps : on quitte l'œuvre, on marque le
   * pas au point médian — l'étape intermédiaire, où les deux œuvres
   * s'entendent à égalité — puis on achève l'arrivée.
   */
  static _pace(t) {
    if (t < 0.4) return easeInOutCubic(t / 0.4) * 0.5;
    if (t < 0.6) return 0.5;
    return 0.5 + easeInOutCubic((t - 0.6) / 0.4) * 0.5;
  }

  _glideStep(dt) {
    if (!this.active || !this._glide || this.app.activeFocus) return;
    const g = this._glide;
    g.t = Math.min(1, g.t + dt / g.dur);
    const k = AudioTour._pace(g.t);
    this.app.camera.position.lerpVectors(g.pts[0], g.pts[1], k);
    this.app.controls.orbit.target.lerpVectors(g.tgts[0], g.tgts[1], k);
    if (g.t >= 1) this._glide = null; // arrivé : la caméra est posée
  }

  /* ----------------------------------------------------------- actions --- */

  /**
   * Pièce précédente/suivante (flèches gauche/droite), en boucle. Les
   * fondus existants du RoomManager jouent. setCurrent résout lui-même un
   * éventuel focus d'œuvre en cours (cancel) et rend false si un fondu est
   * déjà en route — dans ce cas on n'annonce rien : annoncer une pièce dans
   * laquelle on n'est pas entré fausserait le modèle mental de l'utilisateur.
   */
  async _stepRoom(dir) {
    const rooms = this.app.rooms.list();
    if (rooms.length < 2) return;
    const i = rooms.indexOf(this.app.rooms.current);
    const room = rooms[(i + dir + rooms.length) % rooms.length];
    const entered = await this.app.rooms.setCurrent(room.config.id);
    if (!entered) return;
    this._glide = null; // la caméra vient d'être replacée dans la pièce
    this._renderWorks();
    this._updateRoomLabel();
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
    this._announce(`${room.config.title ?? room.config.id}, ${n} œuvre${n > 1 ? 's' : ''}.`);
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
      // C'est ICI que la description se lit — à l'approche, jamais en
      // parcourant la liste.
      const desc = String(f.artwork.config.description ?? '').trim();
      this._announce(`${this._focusedTitle}, approché.${desc ? ' ' + desc : ''}`);
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
