import sourceWorklet from './reverb-worklet.js?raw';
import sourceGalactique from './galactique-worklet.js?raw';
import { REVERB_DEFAUTS, LIEUX, MOTEURS, normaliserReverb, reverbDePiece }
  from './reverb-reglages.js';

export { REVERB_DEFAUTS, LIEUX, MOTEURS, normaliserReverb, reverbDePiece };

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
/** Le retour est un fil, pas un fader : son niveau vient des départs. */
const RETOUR_NOMINAL = 1;

export class Reverb {
  constructor() {
    this.ctx = null;
    this.entree = null;     // là où les départs arrivent
    this.retour = null;     // la sortie, à brancher en tranche
    this.noeud = null;      // le moteur ALIMENTÉ (voir _basculer)
    this.moteurs = {};      // verbity, galactique — montés une fois pour toutes
    this._moteur = 'verbity';
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
      const charger = async (source) => {
        const url = URL.createObjectURL(
          new Blob([source], { type: 'text/javascript' }));
        try { await ctx.audioWorklet.addModule(url); }
        finally { URL.revokeObjectURL(url); }
      };
      await charger(sourceWorklet);
      await charger(sourceGalactique);
      const monter = (nom) => new AudioWorkletNode(ctx, nom, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      // LES DEUX SONT MONTÉS, UN SEUL EST ALIMENTÉ. Un worklet que rien ne
      // relie à la sortie n'est pas appelé : celui qui dort ne coûte donc
      // rien, et l'on évite d'enregistrer un module au milieu d'une visite —
      // `addModule` est asynchrone, et une pièce ne s'ouvre pas en deux fois.
      this.moteurs.verbity = monter('galerie-reverb');
      this.moteurs.galactique = monter('galerie-galactique');
      this.noeud = this.moteurs.verbity;
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
    // ON NOTE TOUJOURS, MÊME SANS CONTEXTE. Refuser ici tant que `installer`
    // n'a pas rendu la main laissait DÉFINITIVEMENT sèches les œuvres
    // branchées pendant ce temps — et c'est justement le cas de la première
    // pièce, qui se charge pendant que le worklet s'enregistre. Le bogue ne
    // se voyait qu'au premier lancement, une fois sur deux, et la salle
    // d'entrée était la seule touchée : le pire des bogues.
    // La carte accepte un départ sans gain ; `_ouvrir` le posera, ici ou
    // depuis `installer` qui rattrape tout ce qui attend.
    if (this.departs.has(bus)) return;
    const depart = { facteur, gain: null };
    this.departs.set(bus, depart);
    this._ouvrir(bus, depart);
  }

  /** Crée le gain de départ — dès que la réverbération est là, pas avant. */
  _ouvrir(bus, depart) {
    if (!this.ctx || !this.disponible || depart.gain) return;
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
    this._basculer(r.moteur, { instant });
    // Les paramètres vont au moteur QUI VA JOUER, pas à celui qui joue
    // encore : la bascule prend quatre-vingts millisecondes (le temps de
    // refermer le retour), et pousser sur `this.noeud` réglait l'ancien
    // pendant que le nouveau démarrait sur ses valeurs d'usine.
    const cible = this.moteurs[r.moteur] ?? this.noeud;
    const p = (nom, v) => {
      const param = cible?.parameters.get(nom);
      if (param) param.value = v;
    };
    if (r.moteur === 'galactique') {
      // Galactic2 n'a pas de taille : son espace est fixe (un stade de dix
      // mille places) et c'est le propos — on ne règle pas les dimensions
      // d'un dehors. Son entrée reste au plein : le DÉPART de la pièce est
      // déjà le dosage, en ajouter un second n'aurait fait que deux robinets
      // pour un seul filet.
      p('poussee', 1);
      p('duree', r.duree);
      p('sombre', r.sombre);
    } else {
      p('taille', r.taille);
      p('duree', r.duree);
      p('sombre', r.sombre);
    }
    const ouverture = r.actif ? r.envoi : 0;
    for (const depart of this.departs.values()) {
      if (!depart.gain) continue;
      const valeur = ouverture * depart.facteur;
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
   * Change de moteur de queue, sans qu'on entende la couture.
   *
   * Débrancher un worklet en pleine queue laisse un moignon : le son
   * s'arrête net au milieu d'une décroissance, ce qu'aucune pièce ne fait.
   * On ferme donc le RETOUR en soixante millisecondes, on échange, puis on
   * rouvre en trois cents. Le tout tient dans le fondu au noir d'un portail,
   * et c'est le seul moment où cela peut arriver — un moteur ne change qu'au
   * changement de pièce.
   *
   * L'ancien moteur est VIDÉ en partant : sa queue, gardée, reviendrait par
   * surprise à la prochaine pièce qui le redemande.
   */
  _basculer(moteur, { instant = false } = {}) {
    const cible = MOTEURS[moteur] ? moteur : 'verbity';
    if (cible === this._moteur || !this.moteurs[cible]) return;
    const ancien = this.moteurs[this._moteur];
    const nouveau = this.moteurs[cible];
    this._moteur = cible;
    const echanger = () => {
      try { this.entree.disconnect(ancien); } catch { /* déjà */ }
      try { ancien.disconnect(); } catch { /* déjà */ }
      try { ancien.port.postMessage({ vider: true }); } catch { /* déjà */ }
      this.entree.connect(nouveau);
      nouveau.connect(this.retour);
      this.noeud = nouveau;
    };
    if (instant) { echanger(); return; }
    // On rouvre sur une valeur NOMINALE, jamais sur celle qu'on vient de
    // lire : deux bascules rapprochées — un aller-retour dans l'éditeur —
    // et la seconde relèverait un gain déjà en train de tomber, pour le
    // rouvrir à zéro. Le retour est un fil, pas un fader : son niveau est
    // porté par les départs.
    const t = this.ctx.currentTime;
    this.retour.gain.cancelScheduledValues(t);
    this.retour.gain.setValueAtTime(this.retour.gain.value, t);
    this.retour.gain.linearRampToValueAtTime(0, t + 0.06);
    clearTimeout(this._bascule);
    this._bascule = setTimeout(() => {
      echanger();
      const t2 = this.ctx.currentTime;
      this.retour.gain.cancelScheduledValues(t2);
      this.retour.gain.setValueAtTime(0, t2);
      this.retour.gain.linearRampToValueAtTime(RETOUR_NOMINAL, t2 + 0.3);
    }, 80);
  }

  /** Le moteur qui porte la queue en ce moment. */
  get moteur() { return this._moteur; }

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
  vider() {
    for (const n of Object.values(this.moteurs)) n?.port.postMessage({ vider: true });
  }
}
