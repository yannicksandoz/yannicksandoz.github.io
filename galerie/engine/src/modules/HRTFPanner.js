import { Module } from './Module.js';

/**
 * Réglage binaural D'ŒUVRE — déclaratif, depuis que la spatialisation vit
 * au cœur du moteur (voir core/Spatialisation.js : une voie HRTF par piste,
 * pour toutes les œuvres).
 *
 * Ce module a longtemps ÉTÉ la spatialisation : il insérait son propre
 * PannerNode entre le bus de l'œuvre et le maître. En garder un ici
 * empilerait deux panners en série — deux convolutions HRTF l'une dans
 * l'autre, un son doublement filtré qui ne vient plus de nulle part. Il ne
 * crée donc plus aucun nœud : il PRÊTE ses paramètres de distance aux voies
 * de l'œuvre, qui les appliquent à leur gain de distance (modèle
 * « inverse », comme avant — mêmes clés, mêmes défauts, mêmes JSON).
 *
 * params :
 *  - refDistance (défaut 2)  : distance de référence (plein volume)
 *  - maxDistance (défaut 60) : l'atténuation plafonne au-delà
 *  - rolloff     (défaut 1)  : vitesse d'atténuation
 *
 * Les défauts sont larges à dessein : le son sert de BOUSSOLE — une œuvre
 * lointaine doit rester faiblement perceptible et attirer le visiteur,
 * plutôt que d'apparaître brutalement à dix mètres. Une piste qui déclare
 * ses propres distances (`spatial: { refDistance… }`) passe devant.
 * La visite audio sans WebGL continue d'injecter ce module : c'est par lui
 * qu'une œuvre reste audible et localisable de loin, à l'oreille seule.
 */
export class HRTFPanner extends Module {
  onAudioReady() {
    // l'instance, pas ses params : l'éditeur règle les curseurs en direct,
    // et les voies relisent `params` à chaque frame
    this.artwork._spatialOverride = this;
  }

  onAudioReleased() {
    if (this.artwork._spatialOverride === this) this.artwork._spatialOverride = null;
  }

  dispose() {
    this.onAudioReleased();
  }
}
