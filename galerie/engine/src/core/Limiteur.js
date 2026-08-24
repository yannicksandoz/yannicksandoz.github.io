import sourceWorklet from './limiteur-worklet.js?raw';
import { LIMITEUR_DEFAUTS, normaliserLimiteur, reductionEnDb }
  from './limiteur-reglages.js';

export { LIMITEUR_DEFAUTS, normaliserLimiteur, reductionEnDb };

/**
 * LE LIMITEUR DU MAÎTRE — ce qui fait qu'approcher n'est pas seulement
 * « plus fort ».
 *
 * Le bus maître allait droit à la sortie. Quinze sources qui s'additionnent
 * y saturent, et l'approche d'une œuvre ne s'entendait que comme un volume
 * qui monte. Avec un limiteur, le plafond tient : le son dont on s'approche
 * prend la place, et tout le reste recule d'exactement ce qu'il gagne. La
 * proximité devient une PRÉSENCE. C'est le mixage qui parle : ce qui
 * compresse le bus est ce qui commande le bus.
 *
 * L'étage lui-même est un portage des plugins Airwindows de Chris Johnson
 * (MIT) — voir `limiteur-worklet.js`, qui porte le crédit et le détail.
 *
 * DEUX CHEMINS, parce qu'un AudioWorklet peut manquer à l'appel (contexte
 * non sécurisé, navigateur ancien, `addModule` refusé) :
 *   • le worklet, qui est le vrai limiteur ;
 *   • à défaut, un DynamicsCompressorNode réglé en limiteur, suivi d'un
 *     écrêteur doux — moins fin, mais le geste reste le même, et la galerie
 *     ne se retrouve jamais sans plafond.
 *
 * Le module est chargé depuis une URL Blob, et non un fichier à part : le
 * site vit sous un chemin de base (`/galerie/`), se publie par recopie, et
 * doit fonctionner hors ligne. Une source inlinée n'a ni chemin à deviner ni
 * requête à faire échouer.
 */

export class Limiteur {
  constructor() {
    this.ctx = null;
    this.entree = null;      // le nœud où brancher le maître
    this.noeud = null;       // worklet ou compresseur
    this.mode = 'aucun';     // 'worklet' | 'repli' | 'aucun'
    this.reglages = { ...LIMITEUR_DEFAUTS };
    this._reduction = 0;     // dB, lissés pour l'affichage
    this._url = null;
  }

  /**
   * Installe le limiteur entre `source` et `destination`.
   *
   * Le branchement direct reste en place TANT QUE le worklet n'est pas prêt :
   * `addModule` est asynchrone, et couper le son en attendant ferait un trou
   * d'une demi-seconde au démarrage — juste après le bouton « Entrer », au
   * moment précis où l'on écoute.
   */
  async installer(ctx, source, destination = ctx.destination) {
    this.ctx = ctx;
    this.source = source;
    this.destination = destination;

    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      const noeud = new AudioWorkletNode(ctx, 'galerie-limiteur', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      noeud.port.onmessage = (e) => {
        if (typeof e.data?.reduction === 'number') {
          this._reduction = reductionEnDb(e.data.reduction);
        }
      };
      this.noeud = noeud;
      this._entree = noeud;
      this._sortie = noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] limiteur : worklet indisponible, repli —',
        err?.message ?? err);
      const repli = this._repli(ctx);
      this.noeud = repli.entree;
      this._entree = repli.entree;
      this._sortie = repli.sortie;
      this.mode = 'repli';
    } finally {
      if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    }

    // On rebranche seulement maintenant : source → limiteur → destination.
    try { source.disconnect(destination); } catch { /* pas encore branché */ }
    source.connect(this._entree);
    this._sortie.connect(destination);
    this.regler(this.reglages);
    return this.mode;
  }

  /**
   * Repli : un compresseur natif en limiteur, puis une saturation sinus —
   * la même courbe que le second étage de Pressure4, faute de son premier.
   */
  _repli(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6;
    comp.ratio.value = 20;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const forme = ctx.createWaveShaper();
    const n = 1024;
    const courbe = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = ((i / (n - 1)) * 2 - 1) * 1.8;
      courbe[i] = Math.sign(x) * (Math.abs(x) > 1.57079633 ? 1 : Math.sin(Math.abs(x)));
    }
    forme.curve = courbe;
    comp.connect(forme);
    this._compresseur = comp;
    // Deux nœuds, donc deux extrémités : on branche DANS le compresseur et
    // l'on ressort PAR la mise en forme.
    return { entree: comp, sortie: forme };
  }

  /** Applique les réglages. Sans effet si le limiteur n'est pas installé. */
  regler(reglages) {
    this.reglages = normaliserLimiteur(reglages);
    const r = this.reglages;
    if (this.mode === 'worklet' && this.noeud?.parameters) {
      const p = (nom, v) => {
        const param = this.noeud.parameters.get(nom);
        if (param) param.value = v;
      };
      p('pression', r.pression);
      p('vitesse', r.vitesse);
      p('douceur', r.douceur);
      p('sortie', r.sortie);
      p('actif', r.actif ? 1 : 0);
      p('compenser', r.compenser ? 1 : 0);
      p('caractere', r.caractere);
    } else if (this.mode === 'repli' && this._compresseur) {
      // La pression déplace le seuil : 0 → -1 dB (le limiteur dort),
      // 1 → -30 dB (il tient tout).
      this._compresseur.threshold.value = r.actif ? -1 - (r.pression * 29) : 0;
      this._compresseur.release.value = 0.05 + ((1 - r.vitesse) * 0.6);
    }
  }

  /** Réduction courante, en décibels (≤ 0). */
  reduction() {
    if (this.mode === 'repli' && this._compresseur) {
      return Math.min(0, this._compresseur.reduction ?? 0);
    }
    return this._reduction;
  }

  /** Le limiteur travaille-t-il vraiment ? (pour l'affichage) */
  get actif() { return this.mode !== 'aucun' && this.reglages.actif; }
}
