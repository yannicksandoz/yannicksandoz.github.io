import { Module } from './Module.js';

/**
 * Spatialisation binaurale : insère un PannerNode HRTF entre le bus de
 * l'œuvre et le bus maître. Le son est localisé dans l'espace (gauche/droite,
 * devant/derrière au casque) et atténué par le modèle de distance du panner.
 *
 * params :
 *  - refDistance (défaut 2)    : distance de référence (plein volume)
 *  - maxDistance (défaut 60)   : distance au-delà de laquelle l'atténuation plafonne
 *  - rolloff     (défaut 1.0)  : vitesse d'atténuation
 *  - distanceModel (défaut 'inverse')
 *
 * Les défauts sont larges à dessein : le son sert de BOUSSOLE — une œuvre
 * lointaine doit rester faiblement perceptible et attirer le visiteur,
 * plutôt que d'apparaître brutalement à dix mètres.
 */
export class HRTFPanner extends Module {
  onAudioReady() {
    const ctx = this.app.audio.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = this.params.distanceModel ?? 'inverse';
    p.refDistance = this.params.refDistance ?? 2;
    p.maxDistance = this.params.maxDistance ?? 60;
    p.rolloffFactor = this.params.rolloff ?? 1.0;
    this.panner = p;

    // re-routage : bus → panner → master
    const bus = this.artwork.bus;
    bus.disconnect();
    bus.connect(p);
    p.connect(this.app.audio.master);
    this._syncPosition(0);
  }

  update(_dt, _ctx) {
    // position mise à jour en continu : suit les déplacements en mode édition
    if (this.panner) this._syncPosition(0.05);
  }

  _syncPosition(smoothing) {
    const pos = this.artwork.group.position;
    const p = this.panner;
    if (p.positionX) {
      const t = this.app.audio.ctx.currentTime;
      p.positionX.setTargetAtTime(pos.x, t, smoothing);
      p.positionY.setTargetAtTime(pos.y, t, smoothing);
      p.positionZ.setTargetAtTime(pos.z, t, smoothing);
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
  }

  onAudioReleased() {
    this.panner?.disconnect();
    this.panner = null;
  }

  dispose() {
    this.onAudioReleased();
  }
}
