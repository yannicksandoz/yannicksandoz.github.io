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
  if (!hasWebGL2()) {
    bootHeadless();
    return;
  }

  const app = new App(document.getElementById('app'));
  app.ui = new UI();
  app.ui.bindLoading(app.loading);
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
      if (app.activeFocus && app.activeFocus.artwork !== hit.artwork) {
        app.activeFocus.release();
      }
      return hit.artwork.handleClick();
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
    app.ui.showLoadError('Impossible de charger la configuration des œuvres (voir console).');
  }

  app.start(); // la scène tourne déjà derrière l'écran d'accueil
  window.__galerie = app; // point d'entrée debug/console

  // L'éditeur n'est téléchargé qu'au premier déclenchement (², ✎, ?edit).
  setupEditorLoader(app);

  const { audioTour } = await app.ui.waitForEnter();
  app.audio.unlock(); // depuis le geste utilisateur : requis par les navigateurs
  app.rooms.onAudioUnlocked();
  if (audioTour) {
    await startAudioTour(app);
  } else {
    app.ui.maybeShowTouchHint(app.quality.isMobile);
  }
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
  inner.querySelector('.sub').textContent =
    "Votre navigateur ne prend pas en charge WebGL2, nécessaire à l'affichage "
    + "3D. La galerie reste entièrement visitable à l'oreille : navigation au "
    + "clavier, sons spatialisés — casque recommandé.";

  const btn = document.createElement('button');
  btn.id = 'nogl-audio';
  btn.textContent = 'Visite audio (accessible)';
  inner.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Chargement…';
    try {
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

      const [works, rooms] = await Promise.all([loadWorks(), loadRooms()]);
      buildScene(app, works, rooms);
      app.ui.setCredits(works);
      app.start();
      window.__galerie = app;

      app.audio.unlock(); // on est dans le geste utilisateur
      app.rooms.onAudioUnlocked();
      await startAudioTour(app);
      nogl.hidden = true;
    } catch (err) {
      console.error('[galerie] Visite audio impossible à démarrer :', err);
      btn.textContent = 'Échec du chargement — réessayer';
      btn.disabled = false;
    }
  });
}

boot();
