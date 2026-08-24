import sourceWorklet from './monitoring-worklet.js?raw';
import { MODES_ECOUTE, modeEcouteValide } from './ecoute-modes.js';

export { MODES_ECOUTE, modeEcouteValide };

/**
 * L'ÉCOUTE DE CONTRÔLE — les loupes de l'auteur, tout au bout de la chaîne.
 *
 * Portage de **Monitoring** d'Airwindows (Chris Johnson, MIT) — voir
 * `monitoring-worklet.js`, qui porte le crédit et le détail des six modes.
 *
 * Elle se pose APRÈS le limiteur, parce que c'est là que se pose un casque :
 * on veut entendre EXACTEMENT ce qui sort, puis le regarder autrement. Un
 * mode d'écoute ne change jamais ce qui est publié, ne s'écrit nulle part,
 * et retombe sur « normal » en quittant l'onglet Mixage — comme on relâche
 * un solo.
 *
 * En mode normal le worklet est un passe-plat, mais il tourne quand même :
 * le débrancher et le rebrancher à chaque changement ferait un trou dans le
 * son au moment précis où l'on compare deux écoutes.
 */

export class Ecoute {
  constructor() {
    this.ctx = null;
    this.noeud = null;
    this.mode = 'normal';
    this.disponible = false;
  }

  /** Pose l'écoute entre `source` et `destination`. */
  async installer(ctx, source, destination = ctx.destination) {
    this.ctx = ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      const url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); }
      finally { URL.revokeObjectURL(url); }
      this.noeud = new AudioWorkletNode(ctx, 'galerie-monitoring', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      try { source.disconnect(destination); } catch { /* pas encore branché */ }
      source.connect(this.noeud);
      this.noeud.connect(destination);
      this.disponible = true;
    } catch (err) {
      // Sans worklet, pas de loupes — mais la galerie s'entend normalement.
      // On le dit à l'éditeur plutôt que de laisser des boutons sans effet.
      console.warn('[galerie] écoute de contrôle indisponible :',
        err?.message ?? err);
      this.disponible = false;
    }
    return this.disponible;
  }

  regler(mode) {
    const propre = modeEcouteValide(mode);
    this.mode = propre;
    this.noeud?.port.postMessage({ mode: propre });
    return propre;
  }
}
