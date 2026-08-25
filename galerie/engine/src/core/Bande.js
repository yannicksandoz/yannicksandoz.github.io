import sourceWorklet from './bande-worklet.js?raw';
import { BANDE_DEFAUTS, normaliserBande } from './bande-reglages.js';

export { BANDE_DEFAUTS, normaliserBande };

/**
 * LA BANDE — ce qui empêche la galerie d'être parfaite.
 *
 * Portage de **ToTape6** d'Airwindows (Chris Johnson, MIT) — voir
 * `bande-worklet.js` pour le crédit, les trois étages et le pourquoi.
 *
 * Une INSERTION, comme le pupitre et la couleur, posée APRÈS elles : la
 * bande est le dernier étage de caractère, et ce qu'elle fabrique en haut de
 * bande passe encore sous le coupe-haut de l'hygiène. Le plafond reste le
 * dernier mot.
 *
 * Pas de repli natif : un pleurage interpolé et une bosse de tête non
 * linéaire ne s'imitent pas avec des nœuds natifs. Sans worklet, la bande
 * reste éteinte et le dit.
 */
export class Bande {
  constructor() {
    this.ctx = null;
    this.entree = null;
    this.sortie = null;
    this.noeud = null;
    this.mode = 'aucun';    // 'worklet' | 'aucun'
    this.reglages = { ...BANDE_DEFAUTS };
    this._url = null;
  }

  /** Pose la bande entre `source` et `cible`. */
  async installer(ctx, source, cible) {
    this.ctx = ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      this.noeud = new AudioWorkletNode(ctx, 'galerie-bande', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.entree = this.noeud;
      this.sortie = this.noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] bande indisponible :', err?.message ?? err);
      this.mode = 'aucun';
    } finally {
      if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    }

    if (this.mode === 'worklet' && source && cible) {
      try { source.disconnect(cible); } catch { /* pas encore branché */ }
      source.connect(this.entree);
      this.sortie.connect(cible);
    }
    this.regler(this.reglages);
    return this.mode;
  }

  /**
   * Applique les réglages. Le worklet tourne TOUJOURS et passe tout droit
   * quand il dort : rebrancher le graphe à chaque bascule ferait un trou.
   */
  regler(brut) {
    const r = normaliserBande(brut);
    this.reglages = r;
    if (this.mode !== 'worklet' || !this.noeud?.parameters) return r;
    const p = (nom, v) => {
      const param = this.noeud.parameters.get(nom);
      if (param) param.value = v;
    };
    p('actif', r.actif ? 1 : 0);
    p('entree', r.entree);
    p('douceur', r.douceur);
    p('bosse', r.bosse);
    p('pleurage', r.pleurage);
    p('sortie', r.sortie);
    p('melange', r.melange);
    return r;
  }

  get actif() { return this.mode === 'worklet' && this.reglages.actif; }
}
