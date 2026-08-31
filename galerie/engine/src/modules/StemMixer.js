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
    // même pondération que SpatialCrossfade : toutes les courbes de
    // distance obéissent au même réglage (voir Spatialisation)
    const poids = Math.max(0, this.app.spatial?.poidsDistanceDe(this.artwork) ?? 1);
    const t = this.app.audio.ctx.currentTime;
    for (const s of stems) {
      const radius = s.cfg.radius ?? 12;
      const maxGain = s.cfg.gain ?? 1;
      const g = maxGain * Math.pow(smoothstep(radius, radius * innerRatio, ctx.distance), poids);
      // RÉANCRÉ CHAQUE FRAME, À DESSEIN — ne pas « optimiser » ceci par une
      // déduplication de valeur : ce réancrage est le FILET qui rattrape les
      // remises extérieures du gain. `setStemsActive(true)` (réactivation
      // par le budget de voix, à l'entrée d'une pièce) repose chaque piste
      // à PLEIN volume en comptant sur lui ; avec une déduplication, la
      // distance n'ayant pas bougé, le réancrage était sauté et toutes les
      // œuvres de la pièce jouaient comme si l'on était collé à chacune.
      s.gain.gain.setTargetAtTime(g, t, 0.1);
    }
  }
}
