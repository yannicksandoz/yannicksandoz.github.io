import sourceWorklet from './reverb-worklet.js?raw';
import { REVERB_DEFAUTS, LIEUX, normaliserReverb, reverbDePiece }
  from './reverb-reglages.js';

export { REVERB_DEFAUTS, LIEUX, normaliserReverb, reverbDePiece };

/**
 * LA PIÈCE QU'ON ENTEND — un départ, une queue, un retour.
 *
 * Portage de **Verbity** d'Airwindows (Chris Johnson, MIT) — voir
 * `reverb-worklet.js` pour le crédit et la structure.
 *
 * DÉPART / RETOUR, et pas un effet posé sur chaque œuvre. Une pièce est un
 * lieu COMMUN : les quinze œuvres d'une salle sonnent dans le même espace,
 * et c'est justement cela qui fait qu'on les entend ensemble. Une réverbe
 * par œuvre aurait coûté quinze fois plus cher pour un résultat faux — un
 * empilement de quinze salles différentes.
 *
 *   chaque bus d'œuvre ─ départ (gain) ─┐
 *                                       ├─ Verbity ─ retour ─ tranche console
 *   … et le direct part, lui, à sa propre tranche
 *
 * Le retour est une TRANCHE de la table comme une autre, mais sans départ :
 * l'y renvoyer ferait une boucle qui monterait jusqu'à saturer.
 *
 * UNE SEULE INSTANCE. Le visiteur n'est que dans une pièce à la fois ; on
 * change les réglages au passage plutôt que d'entretenir quinze réverbes
 * dont quatorze seraient muettes. La queue de l'ancienne pièce s'éteint
 * pendant que la nouvelle s'installe — c'est ce qu'on entend en franchissant
 * une porte, et c'est gratuit.
 */

/** Durée du fondu du départ au changement de pièce (secondes). */
const FONDU = 0.6;

export class Reverb {
  constructor() {
    this.ctx = null;
    this.entree = null;     // là où les départs arrivent
    this.retour = null;     // la sortie, à brancher en tranche
    this.noeud = null;
    this.disponible = false;
    this.reglages = { ...REVERB_DEFAUTS };
    // bus → { facteur, gain|null }. Le gain n'existe qu'une fois le worklet
    // monté ; le FACTEUR, lui, est noté tout de suite (voir brancherDepart).
    this.departs = new Map();
  }

  /**
   * Monte la réverbération. Rend le nœud de retour, à brancher en tranche —
   * ou null si le worklet manque, auquel cas la galerie reste sèche et le
   * dit plutôt que de laisser des réglages sans effet.
   */
  async installer(ctx) {
    this.ctx = ctx;
    this.entree = ctx.createGain();
    this.retour = ctx.createGain();
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      const url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); }
      finally { URL.revokeObjectURL(url); }
      this.noeud = new AudioWorkletNode(ctx, 'galerie-reverb', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.entree.connect(this.noeud);
      this.noeud.connect(this.retour);
      this.disponible = true;
      // Les œuvres de la première pièce se chargent AVANT que `addModule`
      // n'ait rendu la main : leurs départs ont été notés sans être ouverts.
      // On les ouvre maintenant, sans quoi la pièce d'entrée resterait sèche
      // pour toujours — et seulement elle, ce qui est le pire des bogues :
      // celui qui ne se voit qu'au premier lancement.
      for (const [bus, depart] of this.departs) this._ouvrir(bus, depart);
    } catch (err) {
      console.warn('[galerie] réverbération indisponible :', err?.message ?? err);
      this.disponible = false;
    }
    this.regler(this.reglages, { instant: true });
    return this.disponible ? this.retour : null;
  }

  /**
   * Ouvre un départ pour ce bus. Son gain vaut le départ de la pièce,
   * multiplié par celui de l'œuvre si elle en déclare un — une œuvre peut
   * rester sèche dans une salle qui résonne.
   */
  brancherDepart(bus, facteur = 1) {
    if (!this.ctx || this.departs.has(bus)) return;
    const depart = { facteur, gain: null };
    this.departs.set(bus, depart);
    this._ouvrir(bus, depart);
  }

  /** Crée le gain de départ — dès que la réverbération est là, pas avant. */
  _ouvrir(bus, depart) {
    if (!this.disponible || depart.gain) return;
    const gain = this.ctx.createGain();
    gain.gain.value = (this.reglages.actif ? this.reglages.envoi : 0) * depart.facteur;
    bus.connect(gain);
    gain.connect(this.entree);
    depart.gain = gain;
  }

  debrancherDepart(bus) {
    const depart = this.departs.get(bus);
    if (!depart) return;
    try { depart.gain?.disconnect(); } catch { /* déjà */ }
    this.departs.delete(bus);
  }

  /**
   * Applique les réglages d'une pièce.
   *
   * Le départ se FOND (0,6 s) : couper net en franchissant une porte
   * arracherait la queue au moment précis où l'oreille l'attend. Les
   * paramètres de la queue, eux, changent sur-le-champ — Verbity les relit
   * à chaque bloc, et la transition s'entend comme la pièce qui s'ouvre.
   */
  regler(brut, { instant = false } = {}) {
    const r = normaliserReverb(brut);
    this.reglages = r;
    if (!this.ctx || !this.disponible) return r;
    const t = this.ctx.currentTime;
    const p = (nom, v) => {
      const param = this.noeud?.parameters.get(nom);
      if (param) param.value = v;
    };
    p('taille', r.taille);
    p('duree', r.duree);
    p('sombre', r.sombre);
    const cible = r.actif ? r.envoi : 0;
    for (const depart of this.departs.values()) {
      if (!depart.gain) continue;
      const valeur = cible * depart.facteur;
      // la compensation de distance repartira de cette valeur : on efface sa
      // mémoire, sinon un changement de pièce ne se verrait qu'au prochain
      // mouvement du visiteur
      depart._pose = valeur;
      if (instant) depart.gain.gain.value = valeur;
      else depart.gain.gain.setTargetAtTime(valeur, t, FONDU / 3);
    }
    return r;
  }

  /**
   * Rattrape la distance sur le départ d'un bus.
   *
   * Le départ est pris APRÈS l'atténuation de distance — c'est ce qui permet
   * au fader et au muet de la console d'agir aussi sur la réverbe. Mais du
   * coup il tombait avec le direct, et le rapport direct/réverbe restait
   * figé : on s'éloignait sans que la pièce se referme sur le son. La
   * spatialisation appelle donc ceci à chaque frame avec le facteur calculé
   * par `compensationReverb` (voir air-reglages.js).
   */
  compenser(bus, facteurDistance, t) {
    const depart = this.departs.get(bus);
    if (!depart?.gain) return;
    const cible = (this.reglages.actif ? this.reglages.envoi : 0)
      * depart.facteur * facteurDistance;
    // On ne réécrit que si ça bouge vraiment : soixante automations par
    // seconde et par œuvre pour un millième de gain, c'est du fil audio
    // dépensé pour rien.
    if (Math.abs(cible - (depart._pose ?? -1)) < 1e-3) return;
    depart._pose = cible;
    depart.gain.gain.setTargetAtTime(cible, t ?? this.ctx.currentTime, 0.12);
  }

  /** Coupe la queue net — utile en édition, jamais en visite. */
  vider() { this.noeud?.port.postMessage({ vider: true }); }
}
