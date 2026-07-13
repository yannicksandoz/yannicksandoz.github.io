import './style.css';
import { App } from './core/App.js';
import { Artwork } from './core/Artwork.js';
import { loadWorks } from './core/ConfigLoader.js';
import { registry } from './core/ModuleRegistry.js';
import { Controls } from './controls/Controls.js';
import { Editor } from './editor/Editor.js';
import { UI } from './ui/UI.js';

// --- enregistrement des modules disponibles -------------------------------
// Pour ajouter un comportement : créer une classe dans src/modules/ et
// l'enregistrer ici. Il devient alors activable depuis les JSON d'œuvres.
import { SpatialCrossfade } from './modules/SpatialCrossfade.js';
import { StemMixer } from './modules/StemMixer.js';
import { HRTFPanner } from './modules/HRTFPanner.js';
import { AudioReactive } from './modules/AudioReactive.js';
import { FocusCamera } from './modules/FocusCamera.js';

registry.register('SpatialCrossfade', SpatialCrossfade);
registry.register('StemMixer', StemMixer);
registry.register('HRTFPanner', HRTFPanner);
registry.register('AudioReactive', AudioReactive);
registry.register('FocusCamera', FocusCamera);

// --- amorçage --------------------------------------------------------------
async function boot() {
  const app = new App(document.getElementById('app'));
  app.ui = new UI();
  app.controls = new Controls(app);
  app.editor = new Editor(app);

  app.onUpdate((dt) => app.controls.update(dt));

  // Gestion des clics hors mode édition : focus / défocus des œuvres.
  app.onArtworkClick((artwork) => {
    if (app.editor.enabled) return false; // le handler de l'éditeur s'en charge
    if (artwork) {
      if (app.activeFocus && app.activeFocus.artwork !== artwork) {
        app.activeFocus.release();
      }
      return artwork.handleClick();
    }
    if (app.activeFocus) {
      app.activeFocus.release();
      return true;
    }
    return false;
  });

  // Chargement des œuvres (les assets, eux, sont chargés paresseusement).
  try {
    const works = await loadWorks();
    for (const cfg of works) app.addArtwork(new Artwork(cfg, app));
  } catch {
    document.querySelector('.enter-inner .sub').textContent =
      'Impossible de charger la configuration des œuvres (voir console).';
  }

  app.start(); // la scène tourne déjà derrière l'écran d'accueil

  await app.ui.waitForEnter();
  app.audio.unlock(); // depuis le geste utilisateur : requis par les navigateurs
}

boot();
