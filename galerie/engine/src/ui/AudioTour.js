import * as THREE from 'three';
import { registry } from '../core/ModuleRegistry.js';
import { t, lang, onLangChange } from '../core/i18n.js';
import { easeInOutCubic } from '../core/utils.js';
import { pisteAD, LecteurAD, mountLecteurAD } from '../core/audiodescription.js';
import { estOeuvre } from '../core/catalogue.js';
import { reperer, distanceArrondie, pivoter, classerParDistance } from '../core/orientation.js';
import { estFerme } from '../core/Cooldown.js';

/** Le pluriel des compléments (jetons, passages) : la même règle que `t` pour {s}. */
const pl = (n) => ((lang() === 'en' ? n !== 1 : n > 1) ? 's' : '');

/** Titre prononçable, avec le repli traduit (a11y.js reste côté auteur). */
const titre = (config) => {
  const s = String(config?.title ?? '').trim();
  return s || t('tour.untitled');
};

/**
 * La visite ne parcourt que les œuvres : le décor s'écarte, et les membres
 * d'un ensemble (`partOf`) aussi — la margelle n'est pas une œuvre, le
 * bassin l'est. La règle vient du catalogue, partagée avec la page
 * `liste.html` : une liste ne peut pas annoncer ce que le catalogue ne
 * compte pas.
 */
const oeuvres = (artworks) => (artworks ?? []).filter((a) => estOeuvre(a.config));

/** Temps d'écoute devant chaque œuvre en visite guidée (secondes). */
const PAUSE_AUTO = 8;

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
    this._auto = null;          // autopilote : { i, phase, attente }

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
      this._autoStep(dt);
    });
    // Le catalogue se gagne aussi à l'oreille : les libellés suivent les
    // découvertes, qu'elles viennent d'une approche ou du temps passé tout
    // près — c'est la même règle que dans la visite 3D, au même endroit.
    app.progression?.onChange(() => this._onDecouverte());
    mountLecteurAD(app).onChange((l) => {
      if (!this.active) return;
      this._peindreAD();
      if (!l.enCours) this._announce(t('ad.done'));
    });
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
        <!-- Repère de l'espace courant. Après un changement gauche/droite,
             c'est LUI qui reçoit le focus : le lecteur d'écran lit d'abord
             « Annexe — 1 œuvre » (le focus passe toujours avant la zone
             d'annonces), puis l'annonce donne la première œuvre. -->
        <p id="at-room" tabindex="-1"></p>
        <!-- aria-describedby de l'en-tête : lu à l'arrivée, télégraphique
             à dessein — chaque mot en plus est du temps volé au son. -->
        <p id="at-help">${t('tour.help')}</p>
        <ul id="at-works" role="list" aria-label="${t('tour.works')}"></ul>
        <!-- Les jetons ◈ sont des octaèdres SILENCIEUX cachés dans les
             espaces : rien, à l'oreille, ne permet de les chercher. Les
             annoncer est le seul équivalent honnête de les voir briller —
             sans quoi la visite guidée qu'ils débloquent serait fermée. -->
        <ul id="at-tokens" role="list" aria-label="${t('tour.tokens')}"></ul>
        <!-- Les passages font partie de la MÊME liste verticale que les
             œuvres : on descend des œuvres vers les sorties. Un espace sans
             œuvre n'est donc jamais une impasse — ses portes sont là, à une
             flèche. C'est aussi la seule navigation praticable dans un
             carrefour comme le Belvédère (treize passages). -->
        <ul id="at-doors" role="list" aria-label="${t('tour.doors')}"></ul>
        <!-- Audiodescription de l'œuvre approchée : la voix qui dit ce que
             l'image montre. Elle n'apparaît que lorsqu'on est devant une
             œuvre qui en déclare une — jamais un bouton sans contenu. -->
        <button id="at-ad" hidden aria-pressed="false"></button>
        <!-- Lire la description à voix haute (synthèse du navigateur) quand
             l'œuvre n'a pas d'audiodescription enregistrée : pour qui n'a
             pas de lecteur d'écran, ou l'a coupé pour écouter. -->
        <button id="at-lire" hidden aria-pressed="false">${t('tour.lire')}</button>
        <!-- Les outils de l'oreille : où suis-je (l'inventaire de l'espace,
             les plus proches avec leur direction), pivoter d'un huitième de
             tour à gauche ou à droite (les HRTF font le reste). -->
        <div class="at-outils" role="group" aria-label="${t('tour.outils')}">
          <button id="at-ou">${t('tour.ou')}</button>
          <button id="at-gauche">${t('tour.pivot.gauche')}</button>
          <button id="at-droite">${t('tour.pivot.droite')}</button>
        </div>
        <button id="at-auto" aria-pressed="false">${t('tour.auto')}</button>
        <button id="at-quit">${t('tour.quit')}</button>
        <div id="at-live" aria-live="polite" class="at-sr-only"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.liveEl = el.querySelector('#at-live');

    el.querySelector('#at-quit').addEventListener('click', () => this.stop());
    el.querySelector('#at-auto').addEventListener('click', () => this._basculerAuto());
    el.querySelector('#at-ad').addEventListener('click', () => {
      const art = this.app.activeFocus?.artwork;
      if (art) mountLecteurAD(this.app).basculer(art.config);
    });
    el.querySelector('#at-lire').addEventListener('click', () => this._lireDescription());
    el.querySelector('#at-ou').addEventListener('click', () => this._inventaire());
    el.querySelector('#at-gauche').addEventListener('click', () => this._pivoter(-45));
    el.querySelector('#at-droite').addEventListener('click', () => this._pivoter(45));
    // I : où suis-je ; Maj + gauche/droite : pivoter (les flèches seules changent de pièce)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); this._inventaire(); return; }
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault(); e.stopImmediatePropagation();
        this._pivoter(e.key === 'ArrowRight' ? 45 : -45);
      }
    }, true);

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
    // Reprendre la main : n'importe quelle flèche suffit — on n'apprend pas
    // une touche pour arrêter ce qu'on a lancé d'un bouton.
    el.addEventListener('keydown', (e) => {
      if (!this._auto) return;
      if (e.key.startsWith('Arrow') || e.key === 'Escape') this._arreterAuto();
    });

    // Échap REMONTE : de la liste ou d'un bouton vers l'en-tête ; depuis
    // l'en-tête seulement, il quitte. Un Échap de trop sur « Quitter »
    // rechargeait la page sans prévenir.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.app.activeFocus) return;
      const titre = el.querySelector('#at-title');
      if (document.activeElement === titre) this.stop();
      else titre.focus();
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
    // venu par un lien vers une œuvre (?work=…&mode=audio) : on l'approche
    const art = this.app._lienProfondOeuvre;
    if (art && art.room === room) {
      this.app._lienProfondOeuvre = null;
      setTimeout(() => { if (this.active) this._approach(art); }, 600);
    }
  }

  /** Rend au document ce que la visite lui avait pris (inertie, focus). */
  _releaseDom() {
    this.active = false;
    this._auto = null;
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
   * Pose le libellé sur un bouton, avec sa LANGUE : le titre d'une œuvre est
   * du contenu (français), « Œuvre non découverte » est de l'interface (la
   * langue courante). Sans `lang`, un lecteur d'écran en anglais lisait
   * « Nébuleuse de la porte fermée » avec la voix anglaise.
   */
  _poserLibelle(b, art) {
    const libelle = this._libelle(art);
    b.textContent = '';
    const nom = document.createElement('span');
    nom.textContent = libelle;
    if (libelle !== t('tour.unknown')) nom.lang = 'fr';
    const ou = document.createElement('span');
    ou.className = 'at-ou';
    ou.dataset.ou = '';
    b.append(nom, ou);
    b._cible = () => art.group.getWorldPosition(new THREE.Vector3());
    this._poserRepere(b);
  }

  /**
   * OÙ c'est : « — à gauche, 12 m », relatif au regard de l'auditeur. Une
   * œuvre non découverte le dit aussi : c'est l'équivalent honnête du « ??? »
   * qui brille dans la pièce — on sait qu'il y a quelque chose, et de quel
   * côté. Un passage dit s'il est fermé pour l'instant.
   */
  _poserRepere(b) {
    const ou = b.querySelector('[data-ou]');
    if (!ou || !b._cible) return;
    const r = reperer(this.app.camera.position, this.app.controls.orbit.target, b._cible());
    let texte = ` — ${t(`dir.${r.secteur}`)}, ${distanceArrondie(r.distance, t('dir.pres'))}`;
    if (b._ferme?.()) texte += `, ${t('tour.door.closed.court')}`;
    ou.textContent = texte;
  }

  /** Les repères de toute la liste : après un trajet, un pivot, une approche. */
  _rafraichirReperes() {
    for (const b of this._items()) this._poserRepere(b);
  }

  /** Tout ce qu'il y a dans l'espace, du plus proche au plus loin, avec son repère. */
  _cibles() {
    const cur = this.app.rooms.current;
    if (!cur) return [];
    const liste = [];
    for (const art of oeuvres(cur.artworks)) {
      liste.push({ nom: this._libelle(art), position: art.group.getWorldPosition(new THREE.Vector3()), type: 'oeuvre' });
    }
    for (const mesh of this.app.jetons?.restants(cur.config.id) ?? []) {
      liste.push({ nom: t('tour.token'), position: mesh.getWorldPosition(new THREE.Vector3()), type: 'jeton' });
    }
    for (const salle of this._passages()) {
      const mesh = this._porteVers(salle.config.id);
      if (!mesh) continue;
      liste.push({ nom: t('tour.door', { room: salle.config.title ?? salle.config.id }), position: mesh.getWorldPosition(new THREE.Vector3()), type: 'passage' });
    }
    return classerParDistance(this.app.camera.position, this.app.controls.orbit.target, liste);
  }

  /** Le portail (mesh) de la pièce courante qui mène à `roomId`, s'il est dessiné. */
  _porteVers(roomId) {
    return this.app.rooms.current?.portalMeshes?.find((m) => m.userData.portal?.cfg?.to === roomId) ?? null;
  }

  /** « Où suis-je ? » : l'espace, son compte, et les trois plus proches avec leur direction. */
  _inventaire() {
    const cur = this.app.rooms.current;
    if (!cur) return;
    const { total, n } = this._compteur(cur);
    const jetons = this.app.jetons?.restants(cur.config.id)?.length ?? 0;
    const passages = this._passages().length;
    const proches = this._cibles().slice(0, 3)
      .map((c) => `${c.nom}, ${t(`dir.${c.secteur}`)}, ${distanceArrondie(c.distance, t('dir.pres'))}`)
      .join(' ; ');
    this._announce(t('tour.inventaire', { room: cur.config.title ?? cur.config.id, n, total, jetons, passages, sj: pl(jetons), sp: pl(passages) })
      + (proches ? ` ${t('tour.proches', { liste: proches })}` : ''));
  }

  /** Un huitième de tour sur place : les HRTF font entendre le changement, l'annonce dit ce qui est devant. */
  _pivoter(degres) {
    this._glide = null;
    // une approche en cours tient la caméra : on la relâche d'abord
    this.app.activeFocus?.release?.();
    const pos = this.app.camera.position;
    const cible = this.app.controls.orbit.target;
    const r = pivoter(pos, cible, degres);
    cible.set(r.x, r.y, r.z);
    this.app.camera.lookAt(cible);
    this._rafraichirReperes();
    const devant = this._cibles().find((c) => c.secteur === 'devant');
    this._announce(`${t(degres > 0 ? 'tour.pivot.droite.fait' : 'tour.pivot.gauche.fait')} ${devant
      ? t('tour.devant', { quoi: devant.nom, d: distanceArrondie(devant.distance, t('dir.pres')) })
      : t('tour.devant.rien')}`);
  }

  /**
   * Lire la description à voix haute, par la synthèse du navigateur, quand
   * l'œuvre n'a pas d'audiodescription enregistrée. Dans la langue du
   * contenu. Un second appui arrête.
   */
  _lireDescription() {
    if (typeof speechSynthesis === 'undefined') return;
    if (this._parle) { speechSynthesis.cancel(); this._parle = false; this._peindreAD(); return; }
    const cfg = this.app.activeFocus?.artwork?.config;
    const desc = String(cfg?.description ?? '').trim();
    if (!desc) return;
    const u = new SpeechSynthesisUtterance(`${titre(cfg)}. ${desc}`);
    u.lang = 'fr-FR';
    u.onend = u.onerror = () => { this._parle = false; this._peindreAD(); };
    this._parle = true;
    this._peindreAD();
    speechSynthesis.speak(u);
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
      if (art) this._poserLibelle(b, art);
    }
    this._updateRoomLabel();
    if (!nouvelles.length) return;

    const { total, n } = this._compteur(cur);
    if (n >= total) { this._announce(t('tour.room.done')); this.app.earcons?.jouer('fin'); return; }
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
      this._poserLibelle(b, art);
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
    restants.forEach((mesh, k) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      // numérotés : deux « Jeton ◈ » identiques ne se distinguent pas à l'oreille
      b.textContent = restants.length > 1 ? `${t('tour.token')} ${k + 1}/${restants.length}` : t('tour.token');
      const ou = document.createElement('span'); ou.className = 'at-ou'; ou.dataset.ou = '';
      b.appendChild(ou);
      b._cible = () => mesh.getWorldPosition(new THREE.Vector3());
      this._poserRepere(b);
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
      const mesh = this._porteVers(salle.config.id);
      if (mesh) {
        const ou = document.createElement('span'); ou.className = 'at-ou'; ou.dataset.ou = '';
        b.appendChild(ou);
        b._cible = () => mesh.getWorldPosition(new THREE.Vector3());
        b._ferme = () => estFerme(mesh);
        this._poserRepere(b);
      }
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
    if (g.t >= 1) { this._glide = null; this._rafraichirReperes(); } // arrivé : la caméra est posée
  }

  /* ----------------------------------------------------------- actions --- */

  /**
   * Franchir un passage. Les fondus existants du RoomManager jouent, et
   * `setCurrent` résout lui-même un éventuel focus d'œuvre en cours
   * (cancel) ; il rend false si un fondu est déjà en route — dans ce cas
   * on n'annonce rien : annoncer une pièce dans laquelle on n'est pas
   * entré fausserait le modèle mental de l'utilisateur.
   */
  async _allerVers(roomId, { retour = false, garderAuto = false } = {}) {
    if (!garderAuto) {          // un passage pris à la main arrête la visite guidée
      this._auto = null;
      this._peindreAuto();
    }
    const depart = this.app.rooms.current?.config.id;
    const entered = await this.app.rooms.setCurrent(roomId);
    if (!entered) { this._announce(t('tour.door.closed')); this.app.earcons?.jouer('fermee'); return false; }
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
  /** « 1 jeton, 3 passages. » — ce que la pièce contient hors ses œuvres (déjà dites par le repère). */
  _resumeArrivee() {
    const cur = this.app.rooms.current;
    const jetons = cur ? (this.app.jetons?.restants(cur.config.id)?.length ?? 0) : 0;
    const passages = this._passages().length;
    return t('tour.arrivee', { jetons, passages, sj: pl(jetons), sp: pl(passages) });
  }

  _announceArrivee() {
    const premiere = oeuvres(this.app.rooms.current?.artworks ?? [])[0];
    const resume = this._resumeArrivee();
    if (premiere) {
      // Jamais le titre d'une œuvre qu'on n'a pas encore rencontrée : ce
      // serait la nommer sans l'avoir trouvée. Le repère de pièce, lui,
      // vient d'annoncer « 0 sur 4 » — le silence dit le reste. On dit
      // tout de même où elle est : c'est l'indice honnête.
      const nom = this._libelle(premiere);
      const r = reperer(this.app.camera.position, this.app.controls.orbit.target, premiere.group.getWorldPosition(new THREE.Vector3()));
      const ou = `${t(`dir.${r.secteur}`)}, ${distanceArrondie(r.distance, t('dir.pres'))}`;
      this._announce(`${resume} ${t('tour.premiere', { ou })}`, nom !== t('tour.unknown') ? { contenu: nom } : {});
      return;
    }
    const sorties = this._passages();
    this._announce(`${resume} ` + (sorties.length
      ? t('tour.doors.list', {
        n: sorties.length,
        liste: sorties.map((s) => s.config.title ?? s.config.id).join(', ')
      })
      : t('tour.doors.none')));
  }

  /**
   * L'espace inédit le plus proche, par les passages (parcours en largeur
   * sur le plan de la galerie) : c'est là que la visite guidée continue.
   */
  _prochaineInedite() {
    const cur = this.app.rooms.current;
    if (!cur) return null;
    const vus = new Set([cur.config.id]);
    const file = [cur];
    while (file.length) {
      const salle = file.shift();
      for (const p of salle.config.portals ?? []) {
        const suivante = this.app.rooms.rooms?.get(p.to);
        if (!suivante || vus.has(p.to)) continue;
        vus.add(p.to);
        if (!this._visitees.has(p.to)) return suivante;
        file.push(suivante);
      }
    }
    return null;
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

  /**
   * Le bouton d'audiodescription vit au rythme des approches : il paraît
   * devant une œuvre qui en déclare une, disparaît quand on recule.
   */
  _peindreAD() {
    const b = this.el.querySelector('#at-ad');
    if (!b) return;
    const cfg = this.app.activeFocus?.artwork.config;
    const piste = cfg ? pisteAD(cfg) : null;
    // sans enregistrement : la synthèse du navigateur lit la description
    const lire = this.el.querySelector('#at-lire');
    if (lire) {
      const desc = String(cfg?.description ?? '').trim();
      const peut = Boolean(cfg) && !piste && Boolean(desc) && typeof speechSynthesis !== 'undefined';
      lire.hidden = !peut;
      lire.textContent = this._parle ? t('tour.lire.stop') : t('tour.lire');
      lire.setAttribute('aria-pressed', String(Boolean(peut && this._parle)));
    }
    b.hidden = !piste;
    if (!piste) return;
    const lecteur = mountLecteurAD(this.app);
    const parle = lecteur.enCours === cfg;
    b.lang = piste.lang;
    b.textContent = LecteurAD.libelle(parle);
    b.setAttribute('aria-pressed', String(parle));
  }

  /* --------------------------------------------------------- autopilote --- */

  /**
   * Passer les œuvres de la pièce en revue, une à une : on approche, on
   * laisse le temps d'écouter, on repart. C'est la dérive de la visite 3D
   * transposée à l'oreille — sauf qu'ici elle n'a pas besoin de voler : la
   * même approche que d'habitude fait le travail, avec ses annonces et ses
   * découvertes. Elle ne sort jamais de la pièce : la galerie se parcourt
   * pièce après pièce, l'autopilote aussi.
   */
  _basculerAuto() {
    if (this._auto) { this._arreterAuto(); return; }
    const liste = oeuvres(this.app.rooms.current?.artworks ?? []);
    // un espace vide : la visite part tout de suite vers l'espace inédit le plus proche
    if (!liste.length && !this._prochaineInedite()) { this._announce(t('tour.auto.fin')); return; }
    // on reprend là où le focus se trouve, sinon au début
    const courante = this.app.activeFocus?.artwork;
    const depart = Math.max(0, liste.indexOf(courante));
    this._auto = { i: depart, phase: 'depart', attente: 0 };
    this._peindreAuto();
    this._announce(t('tour.auto.on'));
  }

  _arreterAuto() {
    if (!this._auto) return;
    this._auto = null;
    this._peindreAuto();
    this._announce(t('tour.auto.off'));
  }

  _peindreAuto() {
    const b = this.el.querySelector('#at-auto');
    if (!b) return;
    b.textContent = this._auto ? t('tour.auto.stop') : t('tour.auto');
    b.setAttribute('aria-pressed', String(Boolean(this._auto)));
  }

  _autoStep(dt) {
    if (!this.active || !this._auto) return;
    const liste = oeuvres(this.app.rooms.current?.artworks ?? []);
    const a = this._auto;
    if (a.phase === 'porte') return;   // en route vers l'espace suivant
    if (a.i >= liste.length) {
      // l'espace est parcouru : la visite continue vers l'inédit le plus
      // proche, et s'arrête quand la galerie entière a été entendue
      const suite = this._prochaineInedite();
      if (!suite) {
        this._auto = null;
        this._peindreAuto();
        this._announce(t('tour.auto.fin'));
        this.app.earcons?.jouer('fin');
        return;
      }
      a.phase = 'porte';
      this._announce(t('tour.auto.suite', { room: suite.config.title ?? suite.config.id }));
      this._allerVers(suite.config.id, { garderAuto: true }).then((ok) => {
        if (!this._auto) return;
        if (!ok) { a.phase = 'pause'; a.attente = 2; a.i = liste.length; return; } // porte fermée : on réessaie dans deux secondes
        this._auto = { i: 0, phase: 'depart', attente: 0 };
      });
      return;
    }
    if (a.phase === 'depart') {
      a.phase = 'vol';
      this._approach(liste[a.i]);
      return;
    }
    if (a.phase === 'vol') {
      // on n'attend pas un chronomètre mais l'arrivée réelle : un
      // travelling plus long ne raccourcit pas l'écoute.
      if (this.app.activeFocus?.state === 'focused') {
        a.phase = 'pause';
        a.attente = PAUSE_AUTO;
      }
      return;
    }
    // l'audiodescription en cours a la parole : la visite repart après
    if (mountLecteurAD(this.app).enCours) return;
    a.attente -= dt;
    if (a.attente > 0) return;
    a.i += 1;
    a.phase = 'depart';
  }

  /* ----------------------------------------------------------- annonces --- */

  /**
   * `contenu` : la part en FRANÇAIS (titre, description de l'œuvre), dans
   * un span `lang="fr"` — en interface anglaise, la voix anglaise lisait
   * la description française, inintelligible. `langue` : quand tout le
   * texte est du contenu.
   */
  _announce(text, { contenu = '', langue = '' } = {}) {
    // vider puis remplir force la relecture même d'un texte identique
    this.liveEl.textContent = '';
    if (langue) this.liveEl.setAttribute('lang', langue); else this.liveEl.removeAttribute('lang');
    requestAnimationFrame(() => {
      this.liveEl.textContent = text;
      if (contenu) {
        const span = document.createElement('span');
        span.lang = 'fr';
        span.textContent = ` ${contenu}`;
        this.liveEl.appendChild(span);
      }
    });
  }

  /**
   * Annonce d'ouverture : la pièce et ce qu'elle contient — et quand elle
   * ne contient rien, par où l'on en sort. Le premier geste de la visite
   * ne doit jamais tomber dans le vide.
   */
  _announceRoom(room) {
    const nom = room.config.title ?? room.config.id;
    const n = oeuvres(room.artworks).length;
    if (n > 0) { this._announce(`${t('tour.room', { room: nom, n })}. ${this._resumeArrivee()}`); return; }
    const sorties = this._passages();
    this._announce(`${t('tour.room.empty', { room: nom })}. ${this._resumeArrivee()} ` + (sorties.length
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
      // …et l'audiodescription, si l'œuvre en a une : sans le dire, le
      // bouton apparu après la liste restait inconnu
      const ad = pisteAD(f.artwork.config) ? ` ${t('tour.ad.available')}` : '';
      this._announce(t('tour.approached', { title: this._focusedTitle }) + ad, { contenu: desc });
    } else if (state === 'out' && (this._lastFocusState === 'focused' || this._lastFocusState === 'in')) {
      this._announce(t('tour.back'));
      if (this._parle && typeof speechSynthesis !== 'undefined') { speechSynthesis.cancel(); this._parle = false; }
    }
    if (state !== this._lastFocusState) { this._peindreAD(); this._rafraichirReperes(); }
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
