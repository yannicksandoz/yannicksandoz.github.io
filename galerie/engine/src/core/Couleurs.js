import sourceWorklet from './couleurs-worklet.js?raw';
import { COULEURS, ORDRE_COULEURS, COULEURS_DEFAUTS, normaliserCouleurs,
  indiceDeCouleur } from './couleurs-reglages.js';

export { COULEURS, ORDRE_COULEURS, COULEURS_DEFAUTS, normaliserCouleurs };

/**
 * LA COULEUR DU BUS — la matière de la table, après sa vitesse.
 *
 * Portage de **BussColors4** d'Airwindows (Chris Johnson, MIT) — voir
 * `couleurs-worklet.js` pour le crédit, les huit modèles et le pourquoi.
 *
 * Une INSERTION, comme le pupitre et l'hygiène. Elle se pose JUSTE APRÈS le
 * pupitre : d'abord ce que la table n'arrive pas à suivre, ensuite la
 * matière de son bus, et l'hygiène derrière pour ramasser ce que les deux
 * saturations ont fabriqué au-dessus de vingt kilohertz.
 *
 * Pas de repli natif, pour la même raison que le pupitre : une convolution à
 * trente-trois prises dont les poids bougent avec l'affaissement de
 * l'alimentation ne s'imite pas avec des nœuds natifs. Sans worklet, la
 * couleur reste éteinte et le dit.
 */
export class Couleurs {
  constructor() {
    this.ctx = null;
    this.entree = null;
    this.sortie = null;
    this.noeud = null;
    this.mode = 'aucun';    // 'worklet' | 'aucun'
    this.reglages = { ...COULEURS_DEFAUTS };
    this._url = null;
  }

  /** Pose la couleur entre `source` et `cible`. */
  async installer(ctx, source, cible) {
    this.ctx = ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      this.noeud = new AudioWorkletNode(ctx, 'galerie-couleurs', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.entree = this.noeud;
      this.sortie = this.noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] couleurs de bus indisponibles :', err?.message ?? err);
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
   * quand il dort : rebrancher le graphe à chaque bascule ferait un trou, et
   * c'est un réglage qu'on essaie en boucle pour comparer.
   */
  regler(brut) {
    const r = normaliserCouleurs(brut);
    this.reglages = r;
    if (this.mode !== 'worklet' || !this.noeud?.parameters) return r;
    const p = (nom, v) => {
      const param = this.noeud.parameters.get(nom);
      if (param) param.value = v;
    };
    p('actif', r.actif ? 1 : 0);
    p('couleur', indiceDeCouleur(r.couleur));
    p('entree', r.entree);
    p('sortie', r.sortie);
    p('melange', r.melange);
    return r;
  }

  /** La couleur qui travaille en ce moment, ou null si l'étage dort. */
  get couleur() {
    return this.mode === 'worklet' && this.reglages.actif ? this.reglages.couleur : null;
  }

  get actif() { return this.mode === 'worklet' && this.reglages.actif; }
}
