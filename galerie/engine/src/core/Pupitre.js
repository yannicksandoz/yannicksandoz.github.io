import sourceWorklet from './pupitre-worklet.js?raw';
import { PUPITRES, ORDRE_PUPITRES, PUPITRE_DEFAUTS, normaliserPupitre,
  indiceDePupitre } from './pupitre-reglages.js';

export { PUPITRES, ORDRE_PUPITRES, PUPITRE_DEFAUTS, normaliserPupitre };

/**
 * LE PUPITRE DU MAÎTRE — sur quelle table la galerie a été mixée.
 *
 * Portage de **Channel9** d'Airwindows (Chris Johnson, MIT) — voir
 * `pupitre-worklet.js` pour le crédit, les cinq tables et le pourquoi.
 *
 * Une INSERTION, comme l'hygiène : le maître entre d'un côté et ressort de
 * l'autre. Elle se pose entre le décodage de la console et l'hygiène — une
 * table est ce qui REÇOIT la somme, pas ce qui la fabrique, et la saturation
 * qu'elle ajoute doit encore passer sous le coupe-haut.
 *
 * PAS DE REPLI NATIF, et c'est assumé. L'hygiène en a un parce qu'un
 * passe-bas est un passe-bas, et que le navigateur sait en faire un
 * identique. Ici il n'y a pas d'équivalent : un écrêtage de pente au nombre
 * d'or ne se fabrique pas avec des nœuds natifs, et l'imiter de loin
 * donnerait un « à peu près » qui porterait le nom d'une Neve sans en être
 * une. Sans worklet, le pupitre reste donc éteint et le dit — la galerie
 * sonne alors comme avant, ce qui est un défaut honnête.
 */
export class Pupitre {
  constructor() {
    this.ctx = null;
    this.entree = null;
    this.sortie = null;
    this.noeud = null;
    this.mode = 'aucun';    // 'worklet' | 'aucun'
    this.reglages = { ...PUPITRE_DEFAUTS };
    this._url = null;
  }

  /** Pose le pupitre entre `source` et `cible`. */
  async installer(ctx, source, cible) {
    this.ctx = ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      this.noeud = new AudioWorkletNode(ctx, 'galerie-pupitre', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.entree = this.noeud;
      this.sortie = this.noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] pupitre indisponible :', err?.message ?? err);
      this.mode = 'aucun';
    } finally {
      if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    }

    // On ne coupe le fil qu'une fois l'étage prêt. S'il ne l'est pas, on ne
    // touche à rien : la chaîne reste celle d'avant.
    if (this.mode === 'worklet' && source && cible) {
      try { source.disconnect(cible); } catch { /* pas encore branché */ }
      source.connect(this.entree);
      this.sortie.connect(cible);
    }
    this.regler(this.reglages);
    return this.mode;
  }

  /**
   * Applique les réglages.
   *
   * Le worklet tourne TOUJOURS et se contente de passer tout droit quand il
   * dort : rebrancher le graphe à chaque bascule d'un interrupteur ferait un
   * trou, et c'est le genre de réglage qu'on essaie en boucle pour comparer.
   */
  regler(brut) {
    const r = normaliserPupitre(brut);
    this.reglages = r;
    if (this.mode !== 'worklet' || !this.noeud?.parameters) return r;
    const p = (nom, v) => {
      const param = this.noeud.parameters.get(nom);
      if (param) param.value = v;
    };
    p('actif', r.actif ? 1 : 0);
    p('table', indiceDePupitre(r.table));
    p('attaque', r.attaque);
    p('sortie', r.sortie);
    return r;
  }

  /** La table qui travaille en ce moment, ou null si le pupitre dort. */
  get table() {
    return this.mode === 'worklet' && this.reglages.actif ? this.reglages.table : null;
  }

  get actif() { return this.mode === 'worklet' && this.reglages.actif; }
}
