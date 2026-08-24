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

  /**
   * Y a-t-il DÉJÀ un mélangeur de couches sur cette œuvre ?
   *
   * Les deux modules atténuent avec la distance — l'un le bus entier,
   * l'autre chaque piste — et leurs courbes se MULTIPLIENT : une œuvre qui
   * portait les deux décroissait au carré de la portée voulue, et devenait
   * inaudible bien avant le rayon affiché dans l'éditeur. C'est ce que
   * l'import posait par défaut sur tout son ajouté.
   *
   * La règle : le mélangeur de couches l'emporte sur la distance (c'est
   * son objet même), et le fondu spatial se réduit alors au volume de
   * référence de l'œuvre. Aucune scène n'a plus besoin de savoir laquelle
   * des deux courbes gagne.
   */
  get _melangeurPresent() {
    // `moduleType` est posé par le registre : il survit à la minification,
    // contrairement au nom de la classe.
    return this.artwork.modules?.some((m) => m.moduleType === 'StemMixer');
  }

  update(_dt, ctx) {
    const bus = this.artwork.bus;
    if (!bus) return;
    // `baseGain` de l'œuvre servait de valeur initiale au bus, aussitôt
    // écrasée ici : le champ n'avait donc aucun effet dès que ce module
    // existait. Il devient le volume de référence, et `maxGain` sa
    // surcharge locale.
    const maxGain = this.params.maxGain ?? this.artwork.config.baseGain ?? 1;
    const t = this.app.audio.ctx.currentTime;
    if (this._melangeurPresent) {
      bus.gain.setTargetAtTime(maxGain, t, 0.08);
      return;
    }
    const radius = this.params.radius ?? 15;
    const inner = this.params.inner ?? radius * 0.25;
    // `poidsDistance` aplatit la courbe SANS déplacer son zéro : à 0,5 une
    // source encore lointaine s'entend déjà bien — sa direction (portée par
    // la voie spatiale) redevient l'information dominante, au lieu que tout
    // se joue au volume. À 1, rien ne change.
    const poids = this.app.spatial?.poidsDistanceDe(this.artwork) ?? 1;
    const g = maxGain * Math.pow(smoothstep(radius, inner, ctx.distance), Math.max(0, poids));
    bus.gain.setTargetAtTime(g, t, 0.08);
  }
}
