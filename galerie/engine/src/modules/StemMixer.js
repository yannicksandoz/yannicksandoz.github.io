import { Module } from './Module.js';
import { smoothstep } from '../core/utils.js';

/**
 * Mixe individuellement chaque stem de l'œuvre selon la distance : chaque
 * piste possède son propre rayon (champ `radius` du stem) — plus on
 * s'approche, plus de couches se révèlent.
 *
 * Le rayon et le gain de référence viennent de la config des stems
 * ({ file, radius, gain }) : le mode édition les modifie en direct.
 *
 * params :
 *  - innerRatio (défaut 0.2) : fraction du rayon où le stem atteint
 *    son gain maximal.
 */
export class StemMixer extends Module {
  onAudioReady() {
    for (const s of this.artwork.stems) s.gain.gain.value = 0;
  }

  update(_dt, ctx) {
    const stems = this.artwork.stems;
    if (!stems.length || !this.artwork.audioReady) return;
    const innerRatio = this.params.innerRatio ?? 0.2;
    const t = this.app.audio.ctx.currentTime;
    for (const s of stems) {
      const radius = s.cfg.radius ?? 12;
      const maxGain = s.cfg.gain ?? 1;
      const g = maxGain * smoothstep(radius, radius * innerRatio, ctx.distance);
      s.gain.gain.setTargetAtTime(g, t, 0.1);
    }
  }
}
