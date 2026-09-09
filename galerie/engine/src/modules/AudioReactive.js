import { Module } from './Module.js';
import { damp } from '../core/utils.js';
import { suivreEnveloppe, normaliserLien, courseSuivie } from '../core/liens.js';

const BANDS = {
  low: [20, 250],
  mid: [250, 2000],
  high: [2000, 8000],
  all: [20, 16000]
};

/**
 * Analyse le bus audio de l'œuvre (AnalyserNode) et transmet un niveau
 * lissé [0..1] au visuel : pulsation d'échelle, intensité émissive,
 * uniform de shader `uAudio`, intensité de la lumière d'appoint.
 *
 * params :
 *  - band          ('low' | 'mid' | 'high' | 'all', défaut 'all')
 *  - pulseScale    (défaut 0.05) : amplitude de la pulsation d'échelle
 *  - emissiveBoost (défaut 1.2)  : gain d'émission ajouté à plein niveau
 *  - lightBoost    (défaut 2.5)  : multiplicateur de la lumière d'appoint
 *  - gate          (défaut 0.05) : seuil sous lequel le niveau est nul
 *  - smoothing     (défaut 9)    : réactivité du lissage (grand = nerveux)
 *  - attaque, retombee (ms)      : l'enveloppe, comme sur les liens — quand
 *                                  l'une des deux est donnée, elles
 *                                  remplacent `smoothing` (montée et
 *                                  descente peuvent alors différer)
 *  - lien          : SUIVRE UNE AUTRE ŒUVRE de la pièce plutôt que son
 *                    propre son — un lien complet sans `entree` ({ oeuvre,
 *                    signal, hz, bas, haut, gain, attaque, retombee,
 *                    courbe, inverse }, voir core/liens.js) ; le niveau
 *                    transmis au visuel est alors la course de ce lien
 */
export class AudioReactive extends Module {
  onAudioReady() {
    const ctx = this.app.audio.ctx;
    this.level = this.level ?? 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    // simple prise de mesure : n'altère pas le routage existant
    this.artwork.bus.connect(this.analyser);
    this.level = 0;

    const [lo, hi] = BANDS[this.params.band ?? 'all'] ?? BANDS.all;
    const hzPerBin = ctx.sampleRate / this.analyser.fftSize;
    this.binLo = Math.max(0, Math.floor(lo / hzPerBin));
    this.binHi = Math.min(this.data.length - 1, Math.ceil(hi / hzPerBin));
  }

  update(dt, _ctx) {
    const suit = this.params.lien?.oeuvre && this.app.signaux
      ? normaliserLien({ entree: 'niveau', ...this.params.lien }) : null;
    if (suit) {
      // une autre œuvre : le niveau est la course du lien, enveloppe comprise
      this.level = courseSuivie(suit, this.app.signaux.valeur(suit.oeuvre, suit.signal, suit.hz), this._etats ??= new Map(), dt);
    } else {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(this.data);
      let sum = 0;
      for (let i = this.binLo; i <= this.binHi; i++) sum += this.data[i];
      let target = sum / ((this.binHi - this.binLo + 1) * 255);
      const gate = this.params.gate ?? 0.05;
      if (target < gate) target = 0;

      const { attaque, retombee } = this.params;
      if (Number.isFinite(attaque) || Number.isFinite(retombee)) {
        this.level = suivreEnveloppe(this.level, target, dt,
          { attaque: Number.isFinite(attaque) ? attaque : 20, retombee: Number.isFinite(retombee) ? retombee : 150 });
      } else {
        this.level = damp(this.level, target, this.params.smoothing ?? 9, dt);
      }
    }
    // prefers-reduced-motion : l'émission lumineuse reste, la pulsation
    // géométrique (mouvement) est neutralisée
    const reduced = this.app.quality.reducedMotion;
    // l'objet d'options est RECYCLÉ : les œuvres sont réactives par défaut,
    // en fabriquer un par œuvre et par frame nourrissait le ramasse-miettes
    // (setAudioLevel le déstructure aussitôt, il ne le retient jamais)
    const opts = this._opts ??= {};
    opts.pulseScale = reduced ? 0 : (this.params.pulseScale ?? 0.05);
    opts.emissiveBoost = this.params.emissiveBoost ?? 1.2;
    opts.lightBoost = this.params.lightBoost ?? 2.5;
    this.artwork.setAudioLevel(this.level, opts);
  }

  onAudioReleased() {
    this.analyser?.disconnect();
    this.analyser = null;
  }

  dispose() {
    this.onAudioReleased();
  }
}
