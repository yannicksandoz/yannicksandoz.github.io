import sourceWorklet from './premieres-worklet.js?raw';
import { PLACES, PREMIERES_DEFAUT, salleDeTaille, nomDeSalle, normaliserPremieres }
  from './premieres-reglages.js';

export { PLACES, PREMIERES_DEFAUT, salleDeTaille, nomDeSalle, normaliserPremieres };

/**
 * LA PIÈCE ENTENDUE DE PRÈS — hôte de ClearCoat (Airwindows, MIT).
 *
 * La réverbération donne la queue ; celle-ci donne les premiers retours des
 * murs, cinq à deux cents millisecondes après le son. C'est ce qui manque
 * quand on est COLLÉ à une œuvre : la queue y est masquée par le direct, et
 * la salle disparaît alors qu'on est dedans.
 *
 * LE MÊME DÉPART POUR LES DEUX. Une œuvre n'envoie pas deux fois : le gain
 * de départ qu'elle porte déjà (`audio.envoi`, et le fader de la console
 * avec lui) alimente la queue ET les premières réflexions. Deux départs
 * séparés auraient permis une œuvre sèche de queue mais mouillée de
 * premières — ce qui ne veut rien dire d'une pièce — et auraient doublé le
 * nombre de nœuds pour rien.
 *
 *   bus d'œuvre ─ départ ─┬─ Verbity ────── retour ─ tranche console
 *                         └─ ClearCoat ─ gain ─ retour ─ tranche console
 *
 * Le gain est le seul réglage propre à cet étage : `reverb.premieres`, de
 * zéro à un. La SALLE, elle, ne se règle pas séparément — elle se déduit de
 * l'ampleur déjà déclarée pour la queue (voir salleDeTaille).
 */

/** Fondu du retour au changement de pièce, comme pour la queue. */
const FONDU = 0.6;

export class Premieres {
  constructor() {
    this.ctx = null;
    this.entree = null;
    this.retour = null;
    this.noeud = null;
    this.disponible = false;
    this.reglages = { actif: true, taille: 0.4, premieres: PREMIERES_DEFAUT };
  }

  /**
   * Monte l'étage et rend le nœud de retour, à brancher en tranche — ou null
   * si le worklet manque : la galerie garde alors sa queue et le dit, plutôt
   * que de laisser un réglage sans effet.
   */
  async installer(ctx, source) {
    this.ctx = ctx;
    this.entree = ctx.createGain();
    this.retour = ctx.createGain();
    this.retour.gain.value = 0;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      const url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); }
      finally { URL.revokeObjectURL(url); }
      this.noeud = new AudioWorkletNode(ctx, 'galerie-premieres', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      this.entree.connect(this.noeud);
      this.noeud.connect(this.retour);
      // le départ commun : on se branche sur l'entrée de la réverbe
      if (source) source.connect(this.entree);
      this.disponible = true;
    } catch (err) {
      console.warn('[galerie] premières réflexions indisponibles :',
        err?.message ?? err);
      this.disponible = false;
    }
    this.regler(this.reglages, { instant: true });
    return this.disponible ? this.retour : null;
  }

  /**
   * Applique les réglages d'une pièce.
   *
   * Le niveau se FOND (0,6 s) comme le départ de la queue : franchir une
   * porte ne doit pas faire claquer la salle. La salle, elle, change
   * sur-le-champ — c'est un changement de longueurs de ligne, il vide les
   * mémoires, et l'étaler ferait entendre les deux pièces à la fois.
   */
  regler(brut, { instant = false } = {}) {
    const r = {
      actif: brut?.actif !== false,
      taille: Number.isFinite(Number(brut?.taille)) ? Number(brut.taille) : 0.4,
      envoi: Number.isFinite(Number(brut?.envoi)) ? Number(brut.envoi) : 0,
      premieres: normaliserPremieres(brut?.premieres)
    };
    this.reglages = r;
    if (!this.ctx || !this.disponible) return r;
    const param = this.noeud?.parameters.get('salle');
    if (param) param.value = salleDeTaille(r.taille);
    // Le retour vaut le niveau demandé — le départ, lui, est déjà dosé en
    // amont par `envoi` et par le fader de chaque œuvre. Une pièce sans
    // départ n'entend donc rien d'ici non plus, et c'est juste.
    const cible = r.actif ? r.premieres : 0;
    const t = this.ctx.currentTime;
    if (instant) this.retour.gain.value = cible;
    else this.retour.gain.setTargetAtTime(cible, t, FONDU / 3);
    return r;
  }

  /** La salle actuellement montée, pour l'afficher : « 225 places ». */
  get salle() { return nomDeSalle(salleDeTaille(this.reglages.taille)); }

  /** Coupe les réflexions net — utile en édition, jamais en visite. */
  vider() { this.noeud?.port.postMessage({ vider: true }); }
}
