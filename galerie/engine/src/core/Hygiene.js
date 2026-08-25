import sourceWorklet from './hygiene-worklet.js?raw';
import { HYGIENE_DEFAUTS, AIGUS_HZ, GRAVES_HZ, Q_BUTTERWORTH,
  coupureUtile, normaliserHygiene } from './hygiene-reglages.js';

export { HYGIENE_DEFAUTS, normaliserHygiene };

/**
 * LES DEUX BORNES DU MAÎTRE — ce qui sort de l'audible n'en sort pas.
 *
 * Portage d'**Ultrasonic** et **Infrasonic** d'Airwindows (Chris Johnson,
 * MIT) — voir `hygiene-worklet.js` pour le crédit, le détail et le pourquoi.
 *
 * Une INSERTION, pas une tranche : le maître entre d'un côté et ressort de
 * l'autre, sans départ ni retour. On la pose entre la sortie de la console et
 * l'entrée du limiteur, et l'ordre n'est pas négociable — un plafond doit
 * être le dernier mot sur les crêtes.
 *
 * DEUX CHEMINS, comme le limiteur, parce qu'un AudioWorklet peut manquer à
 * l'appel :
 *   • le worklet, en double précision — c'est le vrai filtre. À vingt hertz,
 *     les pôles du dernier biquad sont à 0,9996 du cercle unité : en simple
 *     précision, la mémoire du filtre n'a plus assez de chiffres pour les
 *     tenir, et c'est exactement le genre de bogue qui ne se voit que sur un
 *     navigateur sur trois ;
 *   • à défaut, dix `BiquadFilterNode` natifs. Ce n'est PAS une
 *     approximation : le navigateur applique la même forme (K = tan(π·f/taux),
 *     Q linéaire), ce sont les mêmes coefficients par un autre chemin.
 */
export class Hygiene {
  constructor() {
    this.ctx = null;
    this.entree = null;     // le nœud à alimenter
    this.sortie = null;     // le nœud à brancher plus loin
    this.noeud = null;      // le worklet, s'il est là
    this.mode = 'aucun';    // 'worklet' | 'repli' | 'aucun'
    this.reglages = { ...HYGIENE_DEFAUTS };
    this._url = null;
  }

  /**
   * Pose l'hygiène entre `source` et `cible`.
   *
   * Le branchement direct reste en place TANT QUE le worklet n'est pas prêt :
   * `addModule` est asynchrone, et couper le maître en attendant ferait un
   * trou au démarrage, juste après le bouton « Entrer ».
   */
  async installer(ctx, source, cible) {
    this.ctx = ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      const noeud = new AudioWorkletNode(ctx, 'galerie-hygiene', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.noeud = noeud;
      this.entree = noeud;
      this.sortie = noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] hygiène : worklet indisponible, repli natif —',
        err?.message ?? err);
      const repli = this._repli(ctx);
      this.entree = repli.entree;
      this.sortie = repli.sortie;
      this.mode = 'repli';
    } finally {
      if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    }

    // On ne coupe le fil qu'une fois l'étage prêt : source → hygiène → cible.
    if (source && cible) {
      try { source.disconnect(cible); } catch { /* pas encore branché */ }
      source.connect(this.entree);
      this.sortie.connect(cible);
    }
    this.regler(this.reglages);
    return this.mode;
  }

  /**
   * Repli : les mêmes dix biquads, en natif.
   *
   * Deux cascades séparées, chacune contournable par un aiguillage de deux
   * gains — allumer et éteindre un filtre est un geste d'auteur qui doit
   * marcher dans les deux modes, sinon le repli ment sur ce qu'il fait.
   */
  _repli(ctx) {
    const entree = ctx.createGain();
    const milieu = ctx.createGain();
    const sortie = ctx.createGain();
    const chaine = (type, hz) => {
      const noeuds = Q_BUTTERWORTH.map((q) => {
        const b = ctx.createBiquadFilter();
        b.type = type === 'haut' ? 'highpass' : 'lowpass';
        b.frequency.value = coupureUtile(hz, ctx.sampleRate);
        b.Q.value = q;
        return b;
      });
      for (let i = 0; i < noeuds.length - 1; i++) noeuds[i].connect(noeuds[i + 1]);
      return { debut: noeuds[0], fin: noeuds[noeuds.length - 1] };
    };
    // Chaque étage a DEUX voies qui se rejoignent : la filtrée et la
    // dérivation. `regler` ouvre l'une et ferme l'autre — jamais les deux,
    // sans quoi le filtré et le direct s'additionneraient et le filtre
    // n'ôterait plus que la moitié de ce qu'il ôte.
    const etage = (type, hz, avant, apres) => {
      const c = chaine(type, hz);
      const passe = ctx.createGain();
      const saut = ctx.createGain();
      saut.gain.value = 0;
      avant.connect(c.debut);
      c.fin.connect(passe);
      passe.connect(apres);
      avant.connect(saut);
      saut.connect(apres);
      return { passe, saut };
    };
    this._etageGraves = etage('haut', GRAVES_HZ, entree, milieu);
    this._etageAigus = etage('bas', AIGUS_HZ, milieu, sortie);
    return { entree, sortie };
  }

  /** Applique les réglages. Sans effet si l'hygiène n'est pas installée. */
  regler(brut) {
    const r = normaliserHygiene(brut);
    this.reglages = r;
    if (this.mode === 'worklet' && this.noeud?.parameters) {
      const p = (nom, v) => {
        const param = this.noeud.parameters.get(nom);
        if (param) param.value = v;
      };
      p('aigus', r.aigus ? 1 : 0);
      p('graves', r.graves ? 1 : 0);
    } else if (this.mode === 'repli' && this._etageAigus) {
      // Un filtre éteint est CONTOURNÉ, pas mis à plat : on ne fait pas
      // passer le signal dans cinq biquads pour qu'ils ne fassent rien.
      const t = this.ctx.currentTime;
      const basculer = (etage, actif) => {
        etage.passe.gain.setTargetAtTime(actif ? 1 : 0, t, 0.01);
        etage.saut.gain.setTargetAtTime(actif ? 0 : 1, t, 0.01);
      };
      basculer(this._etageGraves, r.graves);
      basculer(this._etageAigus, r.aigus);
    }
    return r;
  }

  /** L'étage travaille-t-il vraiment ? (pour l'affichage) */
  get actif() {
    return this.mode !== 'aucun' && (this.reglages.aigus || this.reglages.graves);
  }
}
