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
import { Limiteur } from './Limiteur.js';
import { Console, normaliserConsole } from './Console.js';
import { Ecoute } from './Ecoute.js';
import { Reverb } from './Reverb.js';
import { Lointain } from './Lointain.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiteur = new Limiteur();
    this.console = new Console();
    this.ecoute = new Ecoute();
    this.reverb = new Reverb();
    this.lointain = new Lointain();
    this.unlocked = false;
    this._cache = new Map();
    // url → nombre d'œuvres et d'ambiances qui s'en servent (voir load)
    this._usages = new Map();
  }

  /** À appeler depuis un geste utilisateur (obligatoire sur mobile/Safari). */
  unlock() {
    if (!this.unlocked) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // un contexte neuf a un écoutant neuf : la mémoire de `updateListener`
      // ne parle plus de lui
      this._listener = null;
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;

      // La chaîne du maître, dans l'ordre d'une vraie table :
      //   tranches → somme → décodage console → limiteur → sortie
      // La console s'installe tout de suite (des WaveShaper, rien d'async) ;
      // le limiteur la suit dès que son worklet est prêt.
      // Le lointain prend son contexte TOUT DE SUITE, sans attendre son
      // worklet : les œuvres de la première pièce demandent leur insertion
      // dans la foulée de ce geste-ci (voir Lointain.attacher).
      this.lointain.attacher(this.ctx);
      const sortieConsole = this.console.installer(this.ctx, this.master);
      this.master.disconnect(this.ctx.destination);
      sortieConsole.connect(this.ctx.destination);
      // …puis l'écoute de contrôle, tout au bout : c'est là que se pose un
      // casque. Elle attend le limiteur, sans quoi les deux se disputeraient
      // le fil qui va à la sortie.
      this.limiteur.installer(this.ctx, sortieConsole, this.ctx.destination)
        .then(() => this.ecoute.installer(
          this.ctx, this.limiteur._sortie ?? sortieConsole, this.ctx.destination))
        // La réverbération entre par sa propre TRANCHE, sans départ : lui en
        // donner un ferait une boucle qui monterait jusqu'à saturer.
        .then(() => this.reverb.installer(this.ctx))
        .then((retour) => { if (retour) this.console.brancher(retour); })
        // …et le lointain, qui n'est ni un départ ni un étage du maître :
        // une insertion posée dans l'œuvre qui le demande (voir Lointain.js).
        .then(() => this.lointain.installer(this.ctx))
        .catch((e) => console.warn('[galerie] chaîne du maître :', e?.message ?? e));

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

  /**
   * Pousse les réglages du limiteur, et SEULEMENT s'ils ont changé.
   *
   * Appelé à chaque frame : c'est le seul endroit qui voit à la fois le
   * moteur audio et `reglages.json`, et c'est ce qui permet à un curseur de
   * l'éditeur de s'entendre pendant qu'on le traîne. Comparer le texte coûte
   * moins que d'écrire cinq AudioParams soixante fois par seconde — et
   * surtout, cela ne réancre pas d'automation pour rien.
   */
  appliquerLimiteur(reglages) {
    if (!this.limiteur) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    if (signature === this._signatureLimiteur) return;
    this._signatureLimiteur = signature;
    this.limiteur.regler(reglages ?? undefined);
  }

  /**
   * Ouvre une TRANCHE de console pour ce bus. À appeler au lieu de
   * `bus.connect(engine.master)` : la somme se fait encodée, et le bus
   * décode (voir Console.js).
   */
  brancherCanal(bus, { envoi = 1 } = {}) {
    if (!this.ctx) return bus;
    // …et un DÉPART vers la pièce, en plus du direct. Une œuvre peut
    // demander à rester sèche (`audio.envoi: 0`) dans une salle qui résonne.
    this.reverb.brancherDepart(bus, envoi);
    if (!this.console.somme) { bus.connect(this.master); return bus; }
    return this.console.brancher(bus);
  }

  /** Ferme la tranche — sans quoi son encodeur resterait dans le graphe. */
  debrancherCanal(bus) {
    this.reverb.debrancherDepart(bus);
    this.console.debrancher(bus);
  }

  /** Réglages de la pièce entendue, poussés seulement s'ils ont changé. */
  appliquerReverb(reglages, options) {
    if (!this.reverb) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    if (signature === this._signatureReverb) return;
    this._signatureReverb = signature;
    this.reverb.regler(reglages ?? undefined, options);
  }

  /** Muet de travail : couper / rétablir une tranche sans rien écrire. */
  couperCanal(bus) { this.console.couper(bus); }
  retablirCanal(bus) { this.console.retablir(bus); }
  canalCoupe(bus) { return this.console.estCoupe(bus); }

  /** Réglages de la console, poussés seulement s'ils ont changé. */
  appliquerConsole(reglages) {
    if (!this.console) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    if (signature === this._signatureConsole) return;
    this._signatureConsole = signature;
    this.console.regler(normaliserConsole(reglages));
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /**
   * Charge et décode un fichier audio, mis en cache par URL et COMPTÉ.
   *
   * Sans comptage, deux œuvres qui partagent une nappe se la volaient :
   * la première à s'éloigner vidait l'entrée, et la seconde — toujours
   * audible — retéléchargeait puis redécodait le même fichier au prochain
   * rechargement. C'est le cas de `nebuleuse-drone.wav`, commun à deux
   * œuvres, et de `marees-basse.wav`, partagé entre une œuvre et l'ambiance
   * d'une pièce.
   */
  load(url) {
    if (!this.ctx) return Promise.reject(new Error('AudioContext non débloqué'));
    this._usages.set(url, (this._usages.get(url) ?? 0) + 1);
    if (!this._cache.has(url)) {
      // mode cors explicite : un hôte distant doit autoriser le CORS pour
      // que le buffer soit lisible (voir README)
      const p = fetch(url, { mode: 'cors' })
        .then((r) => {
          if (!r.ok) throw new Error(`Audio introuvable : ${url} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((buf) => this.ctx.decodeAudioData(buf));
      // un échec ne doit rester ni en cache ni au compteur
      p.catch(() => { this._cache.delete(url); this._usages.delete(url); });
      this._cache.set(url, p);
    }
    return this._cache.get(url);
  }

  /**
   * Rend un usage. Le buffer n'est oublié que lorsque PLUS PERSONNE ne s'en
   * sert : la mémoire se libère toujours, mais jamais sous les pieds d'une
   * autre œuvre.
   */
  release(url) {
    const reste = (this._usages.get(url) ?? 1) - 1;
    if (reste > 0) { this._usages.set(url, reste); return; }
    this._usages.delete(url);
    this._cache.delete(url);
  }

  /**
   * Aligne le listener Web Audio sur la caméra (position + orientation).
   *
   * Appelé à chaque frame. Quand la caméra n'a pas bougé — visiteur à
   * l'arrêt, fiche d'œuvre ouverte, focus en pause — les neuf valeurs sont
   * identiques à celles déjà posées, et neuf `setTargetAtTime` de plus ne
   * changeraient rien : l'approche exponentielle vers une cible identique
   * est sans mémoire, ré-ancrer l'événement redonne exactement la même
   * courbe. On s'en dispense donc, et le fil audio cesse d'entretenir une
   * automation permanente pour une écoute qui ne bouge pas.
   */
  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    // Colonne -Z = direction de visée, colonne Y = up
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    const d = this._listener;
    if (d && d[0] === px && d[1] === py && d[2] === pz
      && d[3] === fx && d[4] === fy && d[5] === fz
      && d[6] === ux && d[7] === uy && d[8] === uz) return;
    this._listener = [px, py, pz, fx, fy, fz, ux, uy, uz];
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
