import * as THREE from 'three';
import { registry } from '../core/ModuleRegistry.js';
import { t, onLangChange } from '../core/i18n.js';
import { easeInOutCubic } from '../core/utils.js';

/** Titre prononçable, avec le repli traduit (a11y.js reste côté auteur). */
const titre = (config) => {
  const s = String(config?.title ?? '').trim();
  return s || t('tour.untitled');
};

/**
 * La visite ne parcourt que les œuvres : le décor s'écarte, et les membres
 * d'un ensemble (`partOf`) aussi — la margelle n'est pas une œuvre, le
 * bassin l'est. Même règle que `Progression.oeuvres`, sans quoi une liste
 * annoncerait des objets que le catalogue ne compte pas.
 */
const oeuvres = (artworks) => artworks.filter(
  (a) => a.config.role !== 'decor' && !a.config.partOf);

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
    this._glide = null;       // pré-écoute : point vers lequel l'auditeur glisse
    this._historique = [];    // fil d'Ariane : les pièces d'où l'on vient
    this._visitees = new Set(); // pour qu'« avancer » cherche l'inédit
    this._connues = new Set();  // œuvres déjà nommées, pour n'annoncer que le neuf

    this._prepareArtworks();
    this._build();
    // Changement de langue : le panneau se reconstruit dans la nouvelle
    // langue, et si la visite était ouverte elle se rouvre à l'identique
    // (l'en-tête reprend le focus, la nouvelle explication est lue).
    onLangChange(() => {
      const etaitActif = this.active;
      if (etaitActif) this._releaseDom();
      this.el.remove();
      this._build();
      if (etaitActif) this.start();
    });
    app.onUpdate((dt) => {
      this._observeFocus();
      this._glideStep(dt);
    });
    // Le catalogue se gagne aussi à l'oreille : les libellés suivent les
    // découvertes, qu'elles viennent d'une approche ou du temps passé tout
    // près — c'est la même règle que dans la visite 3D, au même endroit.
    app.progression?.onChange(() => this._onDecouverte());
    app.jetons?.onChange((j) => {
      if (!this.active) return;
      // Le bouton du jeton disparaît avec lui : sans quoi le focus tombe
      // dans le vide et les flèches ne répondent plus. On le repose sur le
      // repère de pièce — le même point d'appui qu'en arrivant quelque part.
      const perdu = !this.el.contains(document.activeElement);
      this._renderTokens();
      if (!this._items().some((b) => b.tabIndex === 0)) {
        const premier = this._items()[0];
        if (premier) premier.tabIndex = 0;
      }
      if (perdu || !this.el.contains(document.activeElement)) {
        this.el.querySelector('#at-room').focus();
      }
      this._announce(t('tour.token.taken', { n: j.compte }));
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
      // Le décor (role: "decor") ne fait pas partie de la visite : on ne
      // lui greffe ni approche ni binaural — il n'est pas listé non plus.
      if (art.config.role === 'decor') continue;
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
           aria-label="${t('tour.label')}">
        <!-- Point d'accueil de la visite : le focus se pose sur cet en-tête
             (tabindex -1) et le lecteur d'écran lit « Visite audio » PUIS
             l'explication (aria-describedby) — jamais une œuvre en premier.
             Échap depuis la liste y ramène (l'explication est relue). -->
        <h2 id="at-title" tabindex="-1" aria-describedby="at-help">${t('tour.title')}</h2>
        <!-- Repère de la pièce courante. Après un changement gauche/droite,
             c'est LUI qui reçoit le focus : le lecteur d'écran lit d'abord
             « Annexe — 1 œuvre » (le focus passe toujours avant la zone
             d'annonces), puis l'annonce donne la première œuvre. -->
        <p id="at-room" tabindex="-1"></p>
        <!-- aria-describedby de l'en-tête : lu à l'arrivée, télégraphique
             à dessein — chaque mot en plus est du temps volé au son. -->
        <p id="at-help">${t('tour.help')}</p>
        <ul id="at-works" role="list" aria-label="${t('tour.works')}"></ul>
        <!-- Les jetons ◈ sont des octaèdres SILENCIEUX cachés dans les
             pièces : rien, à l'oreille, ne permet de les chercher. Les
             annoncer est le seul équivalent honnête de les voir briller —
             sans quoi la visite guidée qu'ils débloquent serait fermée. -->
        <ul id="at-tokens" role="list" aria-label="${t('tour.tokens')}"></ul>
        <!-- Les passages font partie de la MÊME liste verticale que les
             œuvres : on descend des œuvres vers les sorties. Une pièce sans
             œuvre n'est donc jamais une impasse — ses portes sont là, à une
             flèche. C'est aussi la seule navigation praticable dans un
             carrefour comme le Belvédère (treize passages). -->
        <ul id="at-doors" role="list" aria-label="${t('tour.doors')}"></ul>
        <button id="at-quit">${t('tour.quit')}</button>
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

    // Une seule liste verticale : les œuvres, puis les passages. Haut/bas
    // la parcourt d'un bout à l'autre (tabindex itinérant) ; droite avance
    // vers l'inconnu, gauche revient sur ses pas. Le focus initial étant
    // sur l'en-tête (le temps que l'explication soit lue), la première
    // flèche y descend.
    el.addEventListener('keydown', (e) => {
      const dansListe = this._items().includes(document.activeElement);
      const surRepere = document.activeElement === el.querySelector('#at-title')
        || document.activeElement === el.querySelector('#at-room');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!dansListe && !surRepere) return;
        e.preventDefault();
        const items = this._items();
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const next = i === -1
          ? items[0] // depuis le dialogue : on entre dans la liste
          : items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        this._moveFocus(items, next);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!dansListe && !surRepere) return;
        e.preventDefault();
        if (e.key === 'ArrowRight') this._avancer();
        else this._revenir();
      }
    });
  }

  /** La liste verticale complète : les œuvres, puis les passages. */
  _items() {
    return [...this.el.querySelectorAll(
      '#at-works button, #at-tokens button, #at-doors button')];
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
    this._noterConnues();
    this._renderWorks();
    this._renderTokens();
    this._renderDoors();
    this._updateRoomLabel();
    // Le focus se pose sur l'en-tête : le lecteur d'écran lit « Visite
    // audio » puis l'explication des contrôles AVANT toute œuvre. Flèche
    // bas ou Tab pour entrer dans la liste.
    this.el.querySelector('#at-title').focus();
    const room = this.app.rooms.current;
    if (room) {
      this._visitees.add(room.config.id);
      this._announceRoom(room);
    }
  }

  /** Rend au document ce que la visite lui avait pris (inertie, focus). */
  _releaseDom() {
    this.active = false;
    this._glide = null;
    this.app.controls.suspended = false;
    for (const el of this._inerted ?? []) el.inert = false;
    this._inerted = [];
    document.getElementById('app')?.removeAttribute('aria-hidden');
    this.el.hidden = true;
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
    this._releaseDom();
    this.app.activeFocus?.cancel?.();
    const nogl = document.getElementById('nogl');
    const btn = document.getElementById('nogl-audio');
    if (nogl && btn) {
      nogl.hidden = false;
      btn.disabled = false;
      btn.textContent = t('nogl.resume');
      btn.focus();
    }
  }

  /* ------------------------------------------------------------ listes --- */

  /* --------------------------------------------------- progression --- */

  /**
   * Ce que dit une entrée de la liste. Tant que l'œuvre n'a pas été
   * rencontrée, elle n'est pas nommée — même pari que le catalogue de la
   * visite 3D, où elle tient son rang sous un « ??? ». Le mot « ??? » ne
   * s'entendant pas, la voix dit « Œuvre non découverte » : on sait
   * qu'elle est là, on ne sait pas encore ce qu'elle est.
   */
  _libelle(art) {
    const p = this.app.progression;
    if (!p || p.estDecouverte(art) || p.estRevelee(art)) return titre(art.config);
    return t('tour.unknown');
  }

  /**
   * Photographie de ce qui est déjà rencontré en arrivant : sans elle, la
   * première découverte de la pièce annoncerait aussi tout ce qu'on avait
   * trouvé lors d'une visite précédente.
   */
  _noterConnues() {
    const p = this.app.progression;
    for (const a of oeuvres(this.app.rooms.current?.artworks ?? [])) {
      if (p?.estDecouverte(a)) this._connues.add(a.config.id);
    }
  }

  /** Nombre d'œuvres de la pièce, et combien sont déjà rencontrées. */
  _compteur(room) {
    const liste = oeuvres(room.artworks);
    const p = this.app.progression;
    const n = p ? liste.filter((a) => p.estDecouverte(a)).length : 0;
    return { total: liste.length, n };
  }

  _updateRoomLabel() {
    const label = this.el.querySelector('#at-room');
    const cur = this.app.rooms.current;
    if (!cur) {
      label.hidden = true;
      return;
    }
    const nom = cur.config.title ?? cur.config.id;
    const { total, n } = this._compteur(cur);
    label.hidden = false;
    // Une pièce vide le dit franchement — « 0 œuvre » se lit mal et
    // s'entend plus mal encore. Sinon le compte se tient dans le champ
    // proche : « 2 sur 4 » dans CETTE pièce, jamais un « 2 sur 60 »
    // décourageant à l'échelle de la galerie.
    label.textContent = total === 0
      ? t('tour.room.empty', { room: nom })
      : n >= total
        ? t('tour.room.complete', { room: nom, total, n: total })
        : t('tour.room.count', { room: nom, n, total });
  }

  /**
   * Une découverte vient de tomber : les libellés se mettent à jour sur
   * place (le focus ne bouge pas), et on l'annonce — sauf quand elle vient
   * d'une approche, que `_observeFocus` annonce déjà et mieux.
   */
  _onDecouverte() {
    if (!this.active) return;
    const cur = this.app.rooms.current;
    if (!cur) return;
    const p = this.app.progression;
    const liste = oeuvres(cur.artworks);

    // ce qui vient d'apparaître, par différence avec le tour précédent
    const nouvelles = liste.filter(
      (a) => p?.estDecouverte(a) && !this._connues.has(a.config.id));
    for (const a of nouvelles) this._connues.add(a.config.id);

    for (const b of this.el.querySelectorAll('#at-works button')) {
      const art = liste.find((a) => a.config.id === b.dataset.work);
      if (art) b.textContent = this._libelle(art);
    }
    this._updateRoomLabel();
    if (!nouvelles.length) return;

    const { total, n } = this._compteur(cur);
    if (n >= total) { this._announce(t('tour.room.done')); return; }
    // Une approche annonce déjà l'œuvre, et mieux : on ne parle par-dessus
    // que pour les découvertes venues du seul fait d'avoir écouté à côté.
    if (this.app.activeFocus) return;
    this._announce(t('tour.discovered', {
      title: titre(nouvelles[0].config), n, total
    }));
  }

  _renderWorks() {
    const ul = this.el.querySelector('#at-works');
    ul.innerHTML = '';
    const room = this.app.rooms.current;
    const artworks = oeuvres(room ? room.artworks : this.app.artworks);
    artworks.forEach((art) => {
      // Titre seul, volontairement : en parcourant, le lecteur d'écran dit
      // le nom puis SE TAIT — c'est le son qui parle. La description n'est
      // lue qu'à l'approche (Entrée), dans l'annonce.
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.dataset.work = art.config.id;
      b.textContent = this._libelle(art);
      b.tabIndex = -1;
      li.appendChild(b);
      b.addEventListener('click', () => this._approach(art));
      b.addEventListener('focus', () => this._audition(art));
      ul.appendChild(li);
    });
    if (!artworks.length) {
      ul.innerHTML = `<li class="at-empty">${t('tour.empty')}</li>`;
    }
  }

  _renderTokens() {
    const ul = this.el.querySelector('#at-tokens');
    ul.innerHTML = '';
    const id = this.app.rooms.current?.config.id;
    const restants = id ? (this.app.jetons?.restants(id) ?? []) : [];
    restants.forEach((mesh) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = t('tour.token');
      b.tabIndex = -1;
      b.addEventListener('click', () => this._allerAuJeton(mesh));
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /**
   * Se rendre au jeton : on y glisse comme vers une œuvre, et c'est la
   * proximité qui le ramasse — exactement comme un visiteur qui marche
   * dessus. Aucune règle en double.
   */
  _allerAuJeton(mesh) {
    const cible = mesh.getWorldPosition(new THREE.Vector3());
    this._glide = {
      pts: [this.app.camera.position.clone(), cible.clone()],
      tgts: [this.app.controls.orbit.target.clone(), cible.clone()],
      t: 0,
      dur: this.app.quality.reducedMotion ? 0.4 : 1.6
    };
  }

  /** Les pièces où mènent les passages de la pièce courante, sans doublon. */
  _passages() {
    const cur = this.app.rooms.current;
    const vus = new Set();
    const sorties = [];
    for (const p of cur?.config.portals ?? []) {
      const salle = this.app.rooms.rooms?.get(p.to);
      if (!salle || vus.has(p.to)) continue;
      vus.add(p.to);
      sorties.push(salle);
    }
    return sorties;
  }

  _renderDoors() {
    const ul = this.el.querySelector('#at-doors');
    ul.innerHTML = '';
    for (const salle of this._passages()) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = t('tour.door', { room: salle.config.title ?? salle.config.id });
      b.tabIndex = -1;
      b.addEventListener('click', () => this._allerVers(salle.config.id));
      li.appendChild(b);
      ul.appendChild(li);
    }
    // Le premier élément de la liste verticale porte le tabindex : c'est par
    // lui qu'on entre, œuvre ou passage selon ce que la pièce contient.
    const premier = this._items()[0];
    if (premier) premier.tabIndex = 0;
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
   * Franchir un passage. Les fondus existants du RoomManager jouent, et
   * `setCurrent` résout lui-même un éventuel focus d'œuvre en cours
   * (cancel) ; il rend false si un fondu est déjà en route — dans ce cas
   * on n'annonce rien : annoncer une pièce dans laquelle on n'est pas
   * entré fausserait le modèle mental de l'utilisateur.
   */
  async _allerVers(roomId, { retour = false } = {}) {
    const depart = this.app.rooms.current?.config.id;
    const entered = await this.app.rooms.setCurrent(roomId);
    if (!entered) return false;
    // Fil d'Ariane : on empile l'endroit d'où l'on vient, sauf quand on
    // revient justement sur ses pas (sinon les deux pièces se renverraient
    // l'une à l'autre indéfiniment).
    if (!retour && depart) this._historique.push(depart);
    this._visitees.add(roomId);
    this._glide = null; // la caméra vient d'être replacée dans la pièce
    this._noterConnues();
    this._renderWorks();
    this._renderTokens();
    this._renderDoors();
    this._updateRoomLabel();
    // Ordre d'annonce voulu : pièce — nombre d'œuvres — puis ce qu'on y
    // trouve. Le focus (lu en premier) va donc au repère de pièce ; la
    // suite passe par la zone d'annonces. Flèche bas pour entrer.
    this.el.querySelector('#at-room').focus();
    this._announceArrivee();
    return true;
  }

  /**
   * Ce qu'on trouve en arrivant : la première œuvre s'il y en a, sinon les
   * passages — une pièce vide doit dire par où l'on repart, sans quoi elle
   * est une porte fermée au nez.
   */
  _announceArrivee() {
    const premiere = oeuvres(this.app.rooms.current?.artworks ?? [])[0];
    if (premiere) {
      // Jamais le titre d'une œuvre qu'on n'a pas encore rencontrée : ce
      // serait la nommer sans l'avoir trouvée. Le repère de pièce, lui,
      // vient d'annoncer « 0 sur 4 » — le silence dit le reste.
      const nom = this._libelle(premiere);
      if (nom !== t('tour.unknown')) this._announce(nom);
      return;
    }
    const sorties = this._passages();
    this._announce(sorties.length
      ? t('tour.doors.list', {
        n: sorties.length,
        liste: sorties.map((s) => s.config.title ?? s.config.id).join(', ')
      })
      : t('tour.doors.none'));
  }

  /** Flèche droite : avancer — de préférence vers une pièce jamais vue. */
  _avancer() {
    const sorties = this._passages();
    if (!sorties.length) { this._announce(t('tour.doors.none')); return; }
    const inedite = sorties.find((s) => !this._visitees.has(s.config.id));
    const retour = this._historique[this._historique.length - 1];
    const suivante = inedite
      ?? sorties.find((s) => s.config.id !== retour)
      ?? sorties[0];
    this._allerVers(suivante.config.id);
  }

  /** Flèche gauche : revenir sur ses pas. */
  _revenir() {
    const precedente = this._historique.pop();
    if (!precedente) { this._announce(t('tour.dead.end')); return; }
    this._allerVers(precedente, { retour: true });
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

  /**
   * Annonce d'ouverture : la pièce et ce qu'elle contient — et quand elle
   * ne contient rien, par où l'on en sort. Le premier geste de la visite
   * ne doit jamais tomber dans le vide.
   */
  _announceRoom(room) {
    const nom = room.config.title ?? room.config.id;
    const n = oeuvres(room.artworks).length;
    if (n > 0) { this._announce(t('tour.room', { room: nom, n })); return; }
    const sorties = this._passages();
    this._announce(`${t('tour.room.empty', { room: nom })}. ` + (sorties.length
      ? t('tour.doors.list', {
        n: sorties.length,
        liste: sorties.map((s) => s.config.title ?? s.config.id).join(', ')
      })
      : t('tour.doors.none')));
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
      this._focusedTitle = titre(f.artwork.config);
      // C'est ICI que la description se lit — à l'approche, jamais en
      // parcourant la liste.
      const desc = String(f.artwork.config.description ?? '').trim();
      this._announce(t('tour.approached', { title: this._focusedTitle })
        + (desc ? ' ' + desc : ''));
    } else if (state === 'out' && (this._lastFocusState === 'focused' || this._lastFocusState === 'in')) {
      this._announce(t('tour.back'));
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
