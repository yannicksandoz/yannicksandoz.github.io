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

/** WebGL2 est requis par Three.js : message clair plutôt qu'écran noir. */
function hasWebGL2() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

// --- amorçage --------------------------------------------------------------
async function boot() {
  if (!hasWebGL2()) {
    document.getElementById('enter-screen').remove();
    document.getElementById('nogl').hidden = false;
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

  // L'éditeur n'est téléchargé qu'au premier déclenchement (E, ✎, ?edit).
  setupEditorLoader(app);

  await app.ui.waitForEnter();
  app.audio.unlock(); // depuis le geste utilisateur : requis par les navigateurs
  app.rooms.onAudioUnlocked();
  app.ui.maybeShowTouchHint(app.quality.isMobile);
}

boot();
