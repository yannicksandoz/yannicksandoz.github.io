/**
 * Moteur audio partagé : un seul AudioContext pour toute la galerie,
 * créé au premier geste utilisateur (bouton « Entrer »), un bus maître,
 * un cache de buffers décodés, et la synchronisation du listener 3D
 * avec la caméra.
 *
 * Robustesse iOS Safari : l'AudioContext peut se retrouver suspendu à tout
 * moment (interruption, retour d'onglet). Un listener global re-déclenche
 * resume() + un buffer silencieux au premier tap suivant — le buffer muet
 * force la réouverture du canal audio quand resume() seul ne suffit pas.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this._cache = new Map();
  }

  /** À appeler depuis un geste utilisateur (obligatoire sur mobile/Safari). */
  unlock() {
    if (!this.unlocked) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;

      // Filet de sécurité iOS : à chaque tap, si le contexte n'est pas
      // « running », on le relance depuis le geste.
      const kick = () => {
        if (this.ctx && this.ctx.state !== 'running') {
          this.ctx.resume().catch(() => {});
          this._playSilentBlip();
        }
      };
      window.addEventListener('touchend', kick, { passive: true });
      window.addEventListener('pointerdown', kick, { passive: true });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._playSilentBlip();
  }

  /** Buffer d'un échantillon muet : réveille la sortie audio d'iOS. */
  _playSilentBlip() {
    if (!this.ctx) return;
    try {
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch { /* sans gravité */ }
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** Charge et décode un fichier audio (mise en cache par URL). */
  load(url) {
    if (!this.ctx) return Promise.reject(new Error('AudioContext non débloqué'));
    if (!this._cache.has(url)) {
      // mode cors explicite : un hôte distant doit autoriser le CORS pour
      // que le buffer soit lisible (voir README)
      const p = fetch(url, { mode: 'cors' })
        .then((r) => {
          if (!r.ok) throw new Error(`Audio introuvable : ${url} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((buf) => this.ctx.decodeAudioData(buf));
      p.catch(() => this._cache.delete(url)); // un échec ne doit pas rester en cache
      this._cache.set(url, p);
    }
    return this._cache.get(url);
  }

  /** Oublie un buffer décodé (libération mémoire au déchargement d'une œuvre). */
  release(url) {
    this._cache.delete(url);
  }

  /** Aligne le listener Web Audio sur la caméra (position + orientation). */
  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    // Colonne -Z = direction de visée, colonne Y = up
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.03);
      l.positionY.setTargetAtTime(py, t, 0.03);
      l.positionZ.setTargetAtTime(pz, t, 0.03);
      l.forwardX.setTargetAtTime(fx, t, 0.03);
      l.forwardY.setTargetAtTime(fy, t, 0.03);
      l.forwardZ.setTargetAtTime(fz, t, 0.03);
      l.upX.setTargetAtTime(ux, t, 0.03);
      l.upY.setTargetAtTime(uy, t, 0.03);
      l.upZ.setTargetAtTime(uz, t, 0.03);
    } else {
      // Fallback ancienne API (Safari)
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }
}
