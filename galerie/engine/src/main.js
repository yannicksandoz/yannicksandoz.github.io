import * as THREE from 'three';
import './style.css';
import { App } from './core/App.js';
import { loadWorks, loadRooms } from './core/ConfigLoader.js';
import { buildScene } from './core/SceneBuilder.js';
import { RoomManager } from './core/RoomManager.js';
import { registry } from './core/ModuleRegistry.js';
import { Controls } from './controls/Controls.js';
import { setupEditorLoader } from './editorLoader.js';
import { UI } from './ui/UI.js';
import { t, initLang } from './core/i18n.js';
import { mountProgression, pointDeVue } from './core/Progression.js';
import { mountBoussole } from './ui/Boussole.js';
import { mountDerive } from './core/Derive.js';

// --- enregistrement des modules disponibles -------------------------------
// Pour ajouter un comportement : créer une classe dans engine/src/modules/
// et l'enregistrer ici. Il devient alors activable depuis les JSON d'œuvres.
import { SpatialCrossfade } from './modules/SpatialCrossfade.js';
import { StemMixer } from './modules/StemMixer.js';
import { HRTFPanner } from './modules/HRTFPanner.js';
import { AudioReactive } from './modules/AudioReactive.js';
import { FocusCamera } from './modules/FocusCamera.js';
import { TipJar } from './modules/TipJar.js';

registry.register('SpatialCrossfade', SpatialCrossfade);
registry.register('StemMixer', StemMixer);
registry.register('HRTFPanner', HRTFPanner);
registry.register('AudioReactive', AudioReactive);
registry.register('FocusCamera', FocusCamera);
registry.register('TipJar', TipJar);

/** WebGL2 est requis par le rendu : message clair plutôt qu'écran noir. */
function hasWebGL2() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** La visite audio est chargée à la demande — jamais pour qui ne l'ouvre pas. */
async function startAudioTour(app) {
  const { mountAudioTour } = await import('./ui/AudioTour.js');
  return mountAudioTour(app);
}

// --- amorçage --------------------------------------------------------------
async function boot() {
  // Avant tout affichage : `lang` du document suit le choix mémorisé — c'est
  // lui qui décide de la voix des lecteurs d'écran.
  initLang();

  if (!hasWebGL2()) {
    bootHeadless();
    return;
  }

  const app = new App(document.getElementById('app'));
  app.ui = new UI();
  app.ui.bindLoading(app.loading);
  app.ui.mountRoomBadge(app);
  // compteur FPS (menu → Réglages → Développement) : s'il était actif à la
  // dernière session, il revient seul — on recharge beaucoup quand on mesure
  import('./ui/FpsMeter.js').then(({ fpsMeterEnabled, mountFpsMeter }) => {
    if (fpsMeterEnabled()) mountFpsMeter(app);
  });
  app.controls = new Controls(app);
  app.rooms = new RoomManager(app);

  app.onUpdate((dt) => app.controls.update(dt));
  app.onUpdate((dt, ctx) => app.rooms.update(dt, ctx));
  app.onUpdate((dt) => app.editor?.update(dt)); // absent tant que non chargé

  // Clics hors mode édition : focus des œuvres, franchissement des portails.
  app.onArtworkClick((hit) => {
    if (app.editor?.enabled) return false; // le handler de l'éditeur s'en charge
    if (hit?.type === 'portal') {
      app.activeFocus?.release();
      app.rooms.traverse(hit.portal);
      return true;
    }
    if (hit?.type === 'artwork') {
      // un membre d'ensemble représente son œuvre maîtresse : cliquer la
      // margelle, c'est ouvrir le bassin
      let art = hit.artwork;
      if (art.config.partOf) {
        art = app.artworks.find((a) => a.config.id === art.config.partOf) ?? art;
      }
      if (app.activeFocus && app.activeFocus.artwork !== art) {
        app.activeFocus.release();
      }
      return art.handleClick();
    }
    if (app.activeFocus) {
      app.activeFocus.release();
      return true;
    }
    return false;
  });

  // Chargement des configurations (les assets, eux, sont paresseux).
  try {
    const [works, rooms] = await Promise.all([
      app.loading.track(loadWorks()),
      loadRooms()
    ]);
    buildScene(app, works, rooms);
    app.ui.setCredits(works);
    app.ui.setReady();
  } catch {
    app.ui.showLoadError(t('enter.error'));
  }

  app.start(); // la scène tourne déjà derrière l'écran d'accueil
  window.__galerie = app; // point d'entrée debug/console

  // Lien profond (?room=x&work=y) : on arrive LÀ où le lien a été partagé,
  // pas à l'entrée — la pièce est posée avant même l'écran d'accueil.
  const lienDirect = appliquerLienProfond(app);

  // L'éditeur n'est téléchargé qu'au premier déclenchement (², ✎, ?edit).
  setupEditorLoader(app);

  if (lienDirect) {
    // Venu par un lien : l'écran d'accueil serait un péage — on entre
    // directement devant l'œuvre. Seul l'audio attend le premier geste
    // (clic, touche, doigt) : c'est la règle des navigateurs, pas la nôtre.
    app.ui.skipEnter();
    const geste = () => {
      window.removeEventListener('pointerdown', geste);
      window.removeEventListener('keydown', geste);
      app.audio.unlock();
      app.rooms.onAudioUnlocked();
    };
    window.addEventListener('pointerdown', geste);
    window.addEventListener('keydown', geste);
    app.ui.maybeShowTouchHint(app.quality.isMobile);
    mountProgression(app).montrerBadge();
    mountBoussole(app);
    mountDerive(app);
  } else {
    const { audioTour } = await app.ui.waitForEnter();
    app.audio.unlock(); // depuis le geste utilisateur : requis par les navigateurs
    app.rooms.onAudioUnlocked();
    if (audioTour) {
      await startAudioTour(app);
    } else {
      app.ui.maybeShowTouchHint(app.quality.isMobile);
      // Les compagnons de la visite 3D : la progression (badge « 3 / 6 »,
      // découvertes persistées), la boussole d'écran, la dérive guidée.
      mountProgression(app).montrerBadge();
      mountBoussole(app);
      mountDerive(app);
    }
  }

  // Échap remonte, partout : en 3D sans œuvre approchée, il ouvre le MENU
  // de la visite (visite audio, aide clavier…) — c'est là que la visite
  // audio devient découvrable une fois entré en 3D. Le menu se referme
  // par Échap (son propre gestionnaire arrête la propagation).
  window.addEventListener('keydown', async (e) => {
    if (e.code !== 'Escape') return;
    if (app.editor?.enabled) return;       // l'éditeur a son propre Échap
    if (app.activeFocus) return;           // FocusCamera gère le recul
    if (app.audioTour?.active) return;     // la visite audio gère les siens
    const { mountVisitMenu } = await import('./ui/VisitMenu.js');
    mountVisitMenu(app);
  });
}

/**
 * Lien profond : `?room=jardin` ouvre la galerie dans le jardin,
 * `?work=nebuleuse` devant la nébuleuse (la pièce se déduit de l'œuvre).
 * Silencieux si l'identifiant n'existe pas — un vieux lien ne casse rien.
 */
function appliquerLienProfond(app) {
  const q = new URLSearchParams(window.location.search);
  const workId = q.get('work');
  const roomId = q.get('room');
  if (!workId && !roomId) return false;

  let art = null;
  if (workId) {
    art = app.artworks.find(
      (a) => a.config.id === workId && a.config.role !== 'decor') ?? null;
  }
  const cible = art?.room?.config.id
    ?? (roomId && app.rooms.rooms.has(roomId) ? roomId : null);
  if (!cible) return false;

  app.rooms.setCurrent(cible, { instant: true });
  if (art) {
    // se poser face à l'œuvre, au point de vue qu'elle déclare — le même
    // que le catalogue et la visite guidée (une seule façon d'arriver)
    const room = app.rooms.current;
    room.group.updateMatrixWorld(true);
    const spawn = room.config.spawn ?? [0, 2.2, 10];
    const vue = pointDeVue(app, art, new THREE.Vector3(spawn[0], spawn[1], spawn[2]));
    app.camera.position.copy(vue.pos);
    app.controls.orbit.target.copy(vue.cible);
    app.controls.resyncCollision?.();
  }
  return true;
}

/**
 * Repli sans WebGL2 : la visite AUDIO, avec le même moteur en mode
 * « sans rendu » (App headless). Pièces, œuvres, modules, spatialisation,
 * fondus : tout est identique — seul le rendu n'existe pas. On propose,
 * l'utilisateur choisit : rien ne démarre sans son geste, qui sert aussi
 * à débloquer l'AudioContext.
 */
function bootHeadless() {
  document.getElementById('enter-screen')?.remove();
  const nogl = document.getElementById('nogl');
  nogl.hidden = false;
  const inner = nogl.querySelector('.enter-inner');
  inner.querySelector('.sub').textContent = t('nogl.sub');

  const btn = document.createElement('button');
  btn.id = 'nogl-audio';
  btn.textContent = t('nogl.start');
  inner.appendChild(btn);

  // Le moteur n'est construit qu'une fois : conservé ici, il est réutilisé
  // si l'utilisateur quitte la visite puis la reprend — et jamais dupliqué
  // après un échec suivi d'un « réessayer » (deux AudioContexts joueraient
  // toutes les ambiances en double).
  let headlessApp = null;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = t('nogl.loading');
    try {
      // Tout ce qui peut échouer passe AVANT le démarrage du moteur : un
      // échec ici laisse zéro boucle, zéro AudioContext débloqué derrière lui.
      const { mountAudioTour } = await import('./ui/AudioTour.js');
      if (!headlessApp) {
        const [works, rooms] = await Promise.all([loadWorks(), loadRooms()]);
        const app = new App(document.getElementById('app'), { headless: true });
        app.ui = new UI();
        // Contrôles factices : la visite audio n'utilise ni clavier de
        // déplacement ni orbite, mais FocusCamera lit `locked` et
        // `orbit.target` — cette poignée suffit.
        app.controls = {
          locked: false, dragging: false, suspended: true,
          orbit: { target: new THREE.Vector3(0, 1.8, 8) },
          update() {}
        };
        app.rooms = new RoomManager(app);
        app.onUpdate((dt, ctx) => app.rooms.update(dt, ctx));
        buildScene(app, works, rooms);
        app.ui.setCredits(works);
        app.start();
        app.audio.unlock(); // le geste utilisateur est encore actif
        app.rooms.onAudioUnlocked();
        headlessApp = app;
        window.__galerie = app;
      }
      mountAudioTour(headlessApp);
      nogl.hidden = true;
    } catch (err) {
      console.error('[galerie] Visite audio impossible à démarrer :', err);
      btn.textContent = t('nogl.failed');
      btn.disabled = false;
    }
  });
}

boot();
