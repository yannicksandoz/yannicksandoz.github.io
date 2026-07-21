import { Module } from './Module.js';
import { smoothstep } from '../core/utils.js';

/**
 * Fait varier le gain global de l'œuvre selon la distance caméra↔œuvre,
 * avec une courbe smoothstep : plein volume à l'intérieur de `inner`,
 * silence au-delà de `radius`.
 *
 * params :
 *  - radius  (défaut 15) : distance de silence
 *  - inner   (défaut radius * 0.25) : distance de volume max
 *  - maxGain (défaut 1)
 */
export class SpatialCrossfade extends Module {
  onAudioReady() {
    // prendre la main sur le bus avant le démarrage des sources
    this.artwork.bus.gain.value = 0;
  }

  update(_dt, ctx) {
    const bus = this.artwork.bus;
    if (!bus) return;
    const radius = this.params.radius ?? 15;
    const inner = this.params.inner ?? radius * 0.25;
    const maxGain = this.params.maxGain ?? 1;
    const g = maxGain * smoothstep(radius, inner, ctx.distance);
    bus.gain.setTargetAtTime(g, this.app.audio.ctx.currentTime, 0.08);
  }
}
