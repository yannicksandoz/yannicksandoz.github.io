import sourceWorklet from './lointain-worklet.js?raw';
import { normaliserLointain, repereLointain, REPERES, SEUIL }
  from './lointain-reglages.js';

export { normaliserLointain, repereLointain, REPERES, SEUIL };

/**
 * L'ŒUVRE QU'ON N'ATTEINDRA PAS — hôte de Distance2 (Airwindows, MIT).
 *
 * Deux distances cohabitent dans la galerie, et il faut les tenir séparées :
 *
 *   — celle qu'on PARCOURT, automatique, la même pour toutes les œuvres :
 *     un passe-bas par voie dont la coupure tombe quand on s'éloigne, plus
 *     le départ de réverbe qui remonte d'autant (voir `air-reglages.js`) ;
 *   — celle qu'on n'ANNULE PAS, écrite par l'auteur, œuvre par œuvre : une
 *     voix au fond d'un couloir qui reste au fond du couloir même quand on
 *     colle l'oreille dessus. C'est ce fichier.
 *
 * PAR ŒUVRE, DONC EN INSERTION. Contrairement à la réverbe — un lieu commun,
 * une seule instance en départ/retour — le lointain appartient à une œuvre
 * seule. Il se pose entre ses voies et son bus :
 *
 *   voies (panner + air + distance) ─ entrée ─ Distance2 ─ retour ─ bus
 *
 * Le bus reste le bus : c'est lui la clé de la console (fader, muet, départ
 * de réverbe). Rien de ce qui existait ne change de main.
 *
 * LE POINT DE FONCTIONNEMENT, ET POURQUOI L'ENTRÉE ET LE RETOUR SONT DES
 * GAINS INVERSES. Distance2 n'est pas linéaire : ses seuils sont ABSOLUS
 * (0,618 et suivants), et c'est en les franchissant que le signal s'émousse.
 * Un signal trop faible ne les atteint jamais — il ressort alors intact et
 * même AMPLIFIÉ par la correction de niveau de Chris (+12 dB mesuré à fond
 * de course). Or il arrive ici déjà atténué par la distance : posé tel quel,
 * l'effet se serait inversé en s'éloignant — l'œuvre serait devenue plus
 * claire et relativement plus forte à mesure qu'on la quittait, exactement
 * le contraire de ce qu'on écrit.
 *
 * On remet donc la source à son niveau avant le traitement, et on rend
 * l'atténuation après : `entree` vaut 1/g, `retour` vaut g, où g est
 * l'atténuation de distance la plus forte de l'œuvre (la spatialisation la
 * calcule déjà pour la réverbe). Le gain net ne bouge pas d'un décibel ;
 * seul le point où mordent les seuils est tenu stable.
 *
 * L'ENTRÉE EXISTE TOUJOURS, le worklet non. Un gain de relais est monté pour
 * chaque œuvre sonore — trois nœuds de plus pour toute la galerie, à côté
 * des deux par piste que coûte déjà la spatialisation. Il sert à deux
 * choses : accueillir les voies avant que `addModule` n'ait rendu la main
 * (sans quoi la première pièce chargée n'aurait jamais son lointain, la même
 * faute que la réverbe a déjà commise une fois), et laisser l'auteur monter
 * le curseur en écoutant. Le worklet, lui, n'est créé que si la valeur passe
 * le seuil — et une fois créé il reste, à zéro : le rebrancher à chaque
 * passage du curseur ferait un clic à chaque aller-retour.
 */

/** Le temps que met le lointain à s'installer quand on le règle (secondes). */
const GLISSE = 0.15;
/**
 * Bornes du rattrapage de niveau. En deçà, une œuvre à l'autre bout d'un
 * belvédère demanderait un facteur de mille : le point de fonctionnement
 * serait juste, mais on amplifierait aussi tout ce qui traîne dans le
 * signal, et un fondu de suspension passerait par là.
 */
const RATTRAPAGE_MIN = 0.05;

export class Lointain {
  constructor() {
    this.ctx = null;
    this.disponible = false;
    // bus → { entree, valeur, noeud|null }
    this.postes = new Map();
  }

  /**
   * Donne le contexte, tout de suite.
   *
   * Appelé au déblocage, AVANT que le worklet ne soit enregistré : les
   * œuvres de la première pièce demandent leur insertion dans la foulée du
   * premier geste, bien avant qu'`addModule` n'ait rendu la main. Sans cette
   * prise de contexte séparée, elles repartaient avec leur bus nu et
   * n'auraient jamais eu de lointain — et seulement elles, ce qui est le
   * pire des bogues : celui qui ne se voit qu'au premier lancement.
   */
  attacher(ctx) { this.ctx = ctx; }

  /** Enregistre le worklet. Sans lui, les entrées restent de simples relais. */
  async installer(ctx) {
    this.ctx = ctx ?? this.ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      const url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); }
      finally { URL.revokeObjectURL(url); }
      this.disponible = true;
      // Les œuvres chargées pendant l'attente ont noté leur valeur sans
      // pouvoir la servir : on les sert maintenant.
      for (const poste of this.postes.values()) this._ajuster(poste);
    } catch (err) {
      console.warn('[galerie] lointain indisponible :', err?.message ?? err);
      this.disponible = false;
    }
  }

  /**
   * Ouvre l'insertion d'un bus et rend le nœud où brancher ses voies.
   *
   * Rend le bus lui-même si le contexte n'est pas là : l'appelant branche
   * comme avant, et la galerie sonne sans lointain plutôt que muette.
   */
  inserer(bus, valeur = 0) {
    if (!this.ctx || !bus) return bus;
    const dejaLa = this.postes.get(bus);
    if (dejaLa) { this.regler(bus, valeur); return dejaLa.entree; }
    const entree = this.ctx.createGain();
    entree.connect(bus);
    const poste = {
      entree, bus, retour: null, valeur: normaliserLointain(valeur),
      noeud: null, pose: 1
    };
    this.postes.set(bus, poste);
    this._ajuster(poste);
    return entree;
  }

  /**
   * Tient le point de fonctionnement : `g` est l'atténuation de distance de
   * l'œuvre (1 = tout près). Appelé à chaque frame par la spatialisation,
   * mais n'écrit que si ça bouge vraiment — voir Reverb.compenser, même
   * raison : soixante automations par seconde et par œuvre pour un millième
   * de gain, c'est du fil audio dépensé pour rien.
   */
  compenser(bus, g, t) {
    const poste = this.postes.get(bus);
    if (!poste?.noeud || !poste.retour) return;
    const facteur = Math.min(1, Math.max(RATTRAPAGE_MIN, Number(g) || 1));
    if (Math.abs(facteur - poste.pose) < 1e-3) return;
    poste.pose = facteur;
    const quand = t ?? this.ctx.currentTime;
    poste.entree.gain.setTargetAtTime(1 / facteur, quand, 0.12);
    poste.retour.gain.setTargetAtTime(facteur, quand, 0.12);
  }

  /** Change la valeur d'une œuvre, en direct. Sans effet si rien ne bouge. */
  regler(bus, valeur) {
    const poste = this.postes.get(bus);
    if (!poste) return;
    const v = normaliserLointain(valeur);
    if (v === poste.valeur) return;
    poste.valeur = v;
    this._ajuster(poste);
  }

  /** Monte le worklet s'il le faut, puis pose la valeur. */
  _ajuster(poste) {
    if (!this.disponible) return;
    if (!poste.noeud && poste.valeur > SEUIL) {
      try {
        poste.noeud = new AudioWorkletNode(this.ctx, 'galerie-lointain', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: 'explicit',
          channelInterpretation: 'speakers'
        });
      } catch (err) {
        console.warn('[galerie] lointain :', err?.message ?? err);
        this.disponible = false;
        return;
      }
      // l'insertion prend la place du fil direct, avec son retour : les deux
      // gains sont inverses l'un de l'autre (voir l'en-tête)
      poste.retour = this.ctx.createGain();
      poste.retour.gain.value = poste.pose;
      poste.entree.gain.value = 1 / poste.pose;
      try { poste.entree.disconnect(poste.bus); } catch { /* déjà */ }
      poste.entree.connect(poste.noeud);
      poste.noeud.connect(poste.retour);
      poste.retour.connect(poste.bus);
    }
    const param = poste.noeud?.parameters.get('lointain');
    if (!param) return;
    // `setTargetAtTime` plutôt qu'une écriture sèche : la pente des limiteurs
    // change avec la valeur, et sauter d'un bloc à l'autre s'entend.
    param.setTargetAtTime(poste.valeur, this.ctx.currentTime, GLISSE / 3);
  }

  /** Ferme l'insertion — le worklet doit mourir avec l'œuvre, pas après. */
  liberer(bus) {
    const poste = this.postes.get(bus);
    if (!poste) return;
    this.postes.delete(bus);
    try { poste.noeud?.port.postMessage({ arret: true }); } catch { /* déjà */ }
    try { poste.noeud?.disconnect(); } catch { /* déjà */ }
    try { poste.retour?.disconnect(); } catch { /* déjà */ }
    try { poste.entree.disconnect(); } catch { /* déjà */ }
  }
}
