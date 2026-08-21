import * as THREE from 'three';

/**
 * La scintillation des jetons ◈.
 *
 * Un octaèdre doré ne fait aucun bruit : on ne peut le chercher qu'à l'œil,
 * et la visite guidée qu'il débloque se ferme à qui ne voit pas. Ici il
 * gagne une voix — un tintement bref, aigu, spatialisé, répété toutes les
 * quelques secondes. On peut alors le pister à l'oreille, comme on suivrait
 * un reflet du regard.
 *
 * Rien n'est téléchargé : deux oscillateurs et une enveloppe suffisent, la
 * galerie ne contacte personne pour ça. Le volume se règle (menu →
 * Réglages), zéro éteint la scintillation sans rien casser d'autre — une
 * clochette qui revient toutes les trois secondes peut lasser, et c'est le
 * visiteur qui en juge, pas nous.
 *
 * Le module OBSERVE : il ne pose ni ne ramasse rien. `Jetons` reste seul
 * maître de la monnaie ; on ne fait que sonner ce qui traîne encore.
 */

const CLE = 'galerie-jetons-volume';
const DEFAUT = 0.35;
const PERIODE = 3.2;      // secondes entre deux tintements
// Portée large à dessein : c'est le modèle de distance qui doit rendre le
// jeton ténu au fond de la salle et net à trois pas — un seuil brutal le
// rendrait introuvable dans une grande pièce (l'Entrée fait trente mètres).
const PORTEE = 60;

let volume = null;

/** Volume de la scintillation, de 0 (muette) à 1. */
export function jetonsVolume() {
  if (volume !== null) return volume;
  try {
    const brut = localStorage.getItem(CLE);
    volume = brut === null ? DEFAUT : Math.min(1, Math.max(0, parseFloat(brut) || 0));
  } catch { volume = DEFAUT; }
  return volume;
}

export function setJetonsVolume(app, v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  try { localStorage.setItem(CLE, String(volume)); } catch { /* stockage refusé */ }
  app?.jetonsSon?.appliquerVolume();
  return volume;
}

export class JetonsSon {
  constructor(app) {
    this.app = app;
    this._voix = new Map();   // mesh → { panner, gain }
    this._prochain = 0;
    this._pos = new THREE.Vector3();
    app.onUpdate((dt, ctx) => this._tick(dt, ctx));
    // Un jeton ramassé se tait à l'instant même, sans attendre l'inventaire
    // de la frame suivante.
    app.jetons?.onChange(() => this._synchroniser());
  }

  /* --------------------------------------------------------- Web Audio --- */

  _voixDe(mesh) {
    const audio = this.app.audio;
    if (!audio?.ctx) return null;
    let voix = this._voix.get(mesh);
    if (voix) return voix;

    const panner = audio.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = PORTEE;
    panner.rolloffFactor = 1.1;
    const gain = audio.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(panner);
    panner.connect(audio.master);
    voix = { panner, gain };
    this._voix.set(mesh, voix);
    return voix;
  }

  /**
   * Un tintement : deux partiels très courts, attaque immédiate, extinction
   * en une demi-seconde. Court à dessein — un son continu deviendrait un
   * acouphène, une clochette reste un repère.
   */
  _tinter(voix, quand) {
    const ctx = this.app.audio.ctx;
    for (const [freq, part] of [[2340, 1], [3510, 0.45]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, quand);
      g.gain.exponentialRampToValueAtTime(0.5 * part, quand + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, quand + 0.5);
      osc.connect(g);
      g.connect(voix.gain);
      osc.start(quand);
      osc.stop(quand + 0.55);
    }
  }

  /** Règle et mémorise le volume (le menu passe par `setJetonsVolume`). */
  setVolume(v) {
    return setJetonsVolume(this.app, v);
  }

  appliquerVolume() {
    const v = jetonsVolume();
    const ctx = this.app.audio?.ctx;
    for (const voix of this._voix.values()) {
      if (ctx) voix.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
      else voix.gain.gain.value = v;
    }
  }

  /* ------------------------------------------------------------ cycle --- */

  /** Coupe les voix des jetons qui ne sont plus là (ramassés, autre pièce). */
  _synchroniser() {
    const id = this.app.rooms?.current?.config.id;
    const vivants = new Set(id ? (this.app.jetons?.restants(id) ?? []) : []);
    for (const [mesh, voix] of this._voix) {
      if (vivants.has(mesh)) continue;
      try { voix.gain.disconnect(); voix.panner.disconnect(); } catch { /* déjà libre */ }
      this._voix.delete(mesh);
    }
  }

  _tick(dt, ctx) {
    const audio = this.app.audio;
    if (!audio?.unlocked || !audio.ctx) return;
    const id = this.app.rooms?.current?.config.id;
    const restants = id ? (this.app.jetons?.restants(id) ?? []) : [];
    if (this._voix.size && this._voix.size !== restants.length) this._synchroniser();
    if (!restants.length) return;

    const v = jetonsVolume();
    if (v <= 0) return;   // muet : on ne construit ni ne planifie rien

    this._prochain -= dt;
    if (this._prochain > 0) return;
    this._prochain = PERIODE;

    const maintenant = audio.ctx.currentTime;
    restants.forEach((mesh, i) => {
      mesh.getWorldPosition(this._pos);
      if (this._pos.distanceTo(ctx.cameraPos) > PORTEE) return;
      const voix = this._voixDe(mesh);
      if (!voix) return;
      voix.gain.gain.value = v;
      const p = voix.panner;
      if (p.positionX) {
        p.positionX.setTargetAtTime(this._pos.x, maintenant, 0.02);
        p.positionY.setTargetAtTime(this._pos.y, maintenant, 0.02);
        p.positionZ.setTargetAtTime(this._pos.z, maintenant, 0.02);
      } else {
        p.setPosition(this._pos.x, this._pos.y, this._pos.z);
      }
      // décalage par jeton : deux jetons voisins ne tintent pas à l'unisson
      this._tinter(voix, maintenant + i * 0.31);
    });
  }
}

/** Point d'entrée : la scintillation suit les jetons de la pièce courante. */
export function mountJetonsSon(app) {
  if (!app.jetonsSon) app.jetonsSon = new JetonsSon(app);
  return app.jetonsSon;
}
