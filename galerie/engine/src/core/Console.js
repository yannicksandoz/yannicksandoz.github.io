import source7 from './console7-worklet.js?raw';
import { POINTS, encoder, decoder, courbe, CONSOLE_DEFAUTS,
  MOTEURS_CONSOLE, normaliserConsole } from './console-reglages.js';

export { encoder, decoder, CONSOLE_DEFAUTS, MOTEURS_CONSOLE, normaliserConsole };
/**
 * LA TABLE DE MIXAGE — Console6, d'Airwindows.
 *
 * D'après **Console6Channel** et **Console6Buss** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows),
 * dont l'encodage/décodage vient lui-même de *torridgristle*, également MIT.
 *
 * Chaque tranche ENCODE son signal, la somme se fait encodée, le bus DÉCODE :
 *
 *   encodage (tranche) :  f(x) = x · (2 − x)        — carré inverse
 *   décodage (bus)     :  g(x) = x / (1 + √(1 − x)) — sa réciproque exacte
 *
 * CE QUE ÇA FAIT VRAIMENT — mesuré, pas supposé. Les deux fonctions sont
 * exactement réciproques : une source SEULE traverse la table sans être
 * touchée, à l'arrondi près, quel que soit le réglage. C'est à PLUSIEURS que
 * la table parle, et de deux façons :
 *
 *   • la somme s'ouvre — quelques sources de niveau moyen ressortent un peu
 *     plus fort que leur simple addition (+1 à +3 dB). C'est le « ça respire »
 *     dont parlent les utilisateurs de Console ;
 *   • la somme est BORNÉE. Quinze sources qui feraient 3,0 en addition pure
 *     sortent à 1,0. C'est là que les sources « se font de la place » : au
 *     plafond, et nulle part ailleurs.
 *
 * Chiffres mesurés (attaque 1), en amplitude linéaire :
 *
 *   une source proche seule   addition 0,70 → table 0,70
 *   1 proche + 4 lointaines   addition 0,90 → table 1,00
 *   6 à mi-distance           addition 0,90 → table 1,00
 *   15 audibles à la fois     addition 3,00 → table 1,00
 *
 * DONC : c'est une COULEUR de sommation, pas un correcteur de niveau, et
 * elle plafonne franchement dès que plusieurs œuvres jouent. Elle est donc
 * livrée ÉTEINTE : on l'allume pour l'entendre, on compare, on décide. Une
 * galerie où tout joue en même temps n'est pas un mixage de studio, et
 * imposer d'office une somme qui colle à son plafond serait exactement le
 * défaut qu'on vient de corriger sur le limiteur.
 *
 * L'ATTAQUE — combien on pousse la table. On atténue AVANT l'encodage et l'on
 * rend l'inverse APRÈS le décodage ; comme les deux fonctions sont
 * réciproques, une source seule reste transparente à toute attaque. Ce qui
 * change, c'est la région où la somme travaille :
 *
 *   attaque → 0   la table s'efface, la somme redevient une addition ;
 *   attaque → 1   la table de Chris, plafond compris.
 *
 * PAS D'ÉTAT, PAS DE SUR-ÉCHANTILLONNAGE — Console6 est une fonction pure,
 * échantillon par échantillon. On l'implémente donc en `WaveShaperNode`
 * natifs plutôt qu'en AudioWorklet : une quinzaine de worklets pour une
 * formule de deux lignes serait payer très cher un calcul que le navigateur
 * fait déjà en code natif.
 */

/** Points de la courbe. 8192 suffisent : la formule est douce partout. */
export class Console {
  constructor() {
    this.ctx = null;
    // 'console6' (des courbes natives, gratuites) ou 'console7' (des
    // worklets, un par tranche). Voir MOTEURS_CONSOLE plus bas.
    this.moteur = CONSOLE_DEFAUTS.moteur;
    this.console7 = 'absent';   // 'absent' | 'pret' | 'refuse'
    this._url7 = null;
    this.somme = null;     // le point où toutes les tranches arrivent
    this.sortie = null;    // ce que branche la suite de la chaîne
    this.decodeur = null;
    this.rendu = null;     // le gain qui rend l'attaque après décodage
    this.actif = CONSOLE_DEFAUTS.actif;
    this.attaque = CONSOLE_DEFAUTS.attaque;
    this.canaux = new Map();   // bus → { attenuation, encodeur, coupe }
    this._courbes = null;
  }

  /**
   * Pose la console autour du point de somme.
   *
   * `sortie` est un nœud FIXE : la suite de la chaîne (le limiteur) s'y
   * branche une fois pour toutes, et allumer ou couper la console ne
   * déplace qu'un seul fil — celui entre la somme et le décodeur.
   */
  installer(ctx, somme) {
    this.ctx = ctx;
    this.somme = somme;
    this._courbes = { encodage: courbe(encoder), decodage: courbe(decoder) };
    this.sortie = ctx.createGain();
    // « none » dans la six : elle est conçue SANS sur-échantillonnage, et en
    // ajouter changerait la courbe que Chris a réglée à l'oreille.
    this.decodeur = this._faireDecodeur();
    this.rendu = ctx.createGain();
    this.rendu.gain.value = 1 / this.attaque;
    this.decodeur.connect(this.rendu);
    this.rendu.connect(this.sortie);
    this._routerBus();
    return this.sortie;
  }

  _routerBus() {
    if (!this.somme) return;
    try { this.somme.disconnect(this.decodeur); } catch { /* pas branché */ }
    try { this.somme.disconnect(this.sortie); } catch { /* pas branché */ }
    if (this.actif) this.somme.connect(this.decodeur);
    else this.somme.connect(this.sortie);
  }

  /**
   * Ouvre une tranche pour ce bus : il arrive à la somme par un encodeur.
   * Rend le bus lui-même, pour que l'appelant reste maître de sa chaîne.
   */
  brancher(bus) {
    if (!this.ctx || this.canaux.has(bus)) return bus;
    const attenuation = this.ctx.createGain();
    attenuation.gain.value = this.attaque;
    const encodeur = this._faireEncodeur();
    attenuation.connect(encodeur);
    encodeur.connect(this.somme);
    this.canaux.set(bus, { attenuation, encodeur, coupe: false });
    bus.connect(this.actif ? attenuation : this.somme);
    return bus;
  }

  /** L'encodeur du moteur courant : une courbe, ou un worklet. */
  _faireEncodeur() {
    if (this.moteur === 'console7' && this.console7 === 'pret') {
      return this._worklet('galerie-console7-tranche');
    }
    const n = this.ctx.createWaveShaper();
    n.curve = this._courbes.encodage;
    n.oversample = 'none';
    return n;
  }

  _faireDecodeur() {
    if (this.moteur === 'console7' && this.console7 === 'pret') {
      return this._worklet('galerie-console7-somme');
    }
    const n = this.ctx.createWaveShaper();
    n.curve = this._courbes.decodage;
    n.oversample = 'none';
    return n;
  }

  _worklet(nom) {
    return new AudioWorkletNode(this.ctx, nom, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    });
  }

  /**
   * Charge le module de la sept, sans rien changer à ce qui joue.
   *
   * On ne le fait qu'UNE FOIS, au montage de la chaîne : enregistrer un
   * module au milieu d'une visite demanderait d'attendre, et une table ne se
   * change pas en deux fois. Tant qu'il n'est pas là, demander la sept
   * retombe sur la six et le dit.
   */
  async preparer(ctx) {
    if (this.console7 !== 'absent') return this.console7;
    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url7 = URL.createObjectURL(
        new Blob([source7], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url7);
      this.console7 = 'pret';
    } catch (err) {
      console.warn('[galerie] Console7 indisponible :', err?.message ?? err);
      this.console7 = 'refuse';
    } finally {
      if (this._url7) { URL.revokeObjectURL(this._url7); this._url7 = null; }
    }
    // le moteur demandé attendait peut-être son module
    if (this.moteur === 'console7' && this.console7 === 'pret') this._rebatir();
    return this.console7;
  }

  /**
   * Refait tous les encodeurs et le décodeur avec le moteur courant.
   *
   * On garde les ATTÉNUATIONS et les fils qui viennent des bus : ce qui
   * change est l'étage du milieu, et le reste du graphe n'a pas à le savoir.
   */
  _rebatir() {
    if (!this.ctx || !this._courbes) return;
    for (const canal of this.canaux.values()) {
      try { canal.attenuation.disconnect(); } catch { /* déjà */ }
      try { canal.encodeur.disconnect(); } catch { /* déjà */ }
      canal.encodeur = this._faireEncodeur();
      canal.attenuation.connect(canal.encodeur);
      canal.encodeur.connect(this.somme);
    }
    try { this.somme.disconnect(this.decodeur); } catch { /* déjà */ }
    try { this.decodeur.disconnect(); } catch { /* déjà */ }
    this.decodeur = this._faireDecodeur();
    this.decodeur.connect(this.rendu);
    this._routerBus();
  }

  /** Le moteur qui travaille vraiment — la sept peut avoir été refusée. */
  get moteurEffectif() {
    return this.moteur === 'console7' && this.console7 === 'pret'
      ? 'console7' : 'console6';
  }

  /** Ferme la tranche : plus rien à elle ne traîne dans le graphe. */
  debrancher(bus) {
    const canal = this.canaux.get(bus);
    if (!canal) return;
    try { canal.attenuation.disconnect(); } catch { /* déjà */ }
    try { canal.encodeur.disconnect(); } catch { /* déjà */ }
    this.canaux.delete(bus);
  }

  /**
   * Couper / rétablir une tranche — le geste « muet » de la console.
   * Il fallait le nommer : couper voulait dire `bus.disconnect(master)`, ce
   * qui, avec une tranche encodée, ne débranche plus rien du tout.
   */
  couper(bus) {
    const canal = this.canaux.get(bus);
    if (!canal || canal.coupe) return;
    try { bus.disconnect(this.actif ? canal.attenuation : this.somme); }
    catch { /* déjà */ }
    canal.coupe = true;
  }

  retablir(bus) {
    const canal = this.canaux.get(bus);
    if (!canal || !canal.coupe) return;
    try { bus.connect(this.actif ? canal.attenuation : this.somme); }
    catch { /* déjà */ }
    canal.coupe = false;
  }

  /** La tranche est-elle coupée ? (l'éditeur a besoin de le savoir) */
  estCoupe(bus) { return Boolean(this.canaux.get(bus)?.coupe); }

  /**
   * Allume ou coupe la console. Couper ne met pas une courbe neutre : cela
   * DÉBRANCHE les encodeurs. Un `WaveShaperNode` écrête son entrée à ±1,
   * même avec une courbe droite — une tranche à 1,4 serait rabotée par un
   * traitement censé être absent.
   */
  regler(brut) {
    const r = normaliserConsole(brut);
    const ancien = this.actif;
    const ancienMoteur = this.moteurEffectif;
    this.actif = r.actif;
    this.attaque = r.attaque;
    this.moteur = r.moteur;

    if (!this.ctx) return;
    // CHANGER DE MOTEUR REFAIT LES QUINZE TRANCHES : on ne le fait donc que
    // si le moteur qui TRAVAILLE change vraiment. Demander la sept quand
    // elle n'est pas là ne doit rien reconstruire.
    if (this.moteurEffectif !== ancienMoteur) this._rebatir();
    // L'attaque se règle en continu : deux gains, et l'un est l'inverse de
    // l'autre. On les pose ensemble, sinon on entend le trou entre les deux.
    const t = this.ctx.currentTime;
    if (this.rendu) this.rendu.gain.setTargetAtTime(1 / this.attaque, t, 0.03);
    for (const canal of this.canaux.values()) {
      canal.attenuation.gain.setTargetAtTime(this.attaque, t, 0.03);
    }
    if (r.actif === ancien) return;

    for (const [bus, canal] of this.canaux) {
      if (canal.coupe) continue;   // muette : on ne la rebranche pas
      try { bus.disconnect(ancien ? canal.attenuation : this.somme); } catch { /* déjà */ }
      try { bus.connect(r.actif ? canal.attenuation : this.somme); } catch { /* déjà */ }
    }
    this._routerBus();
  }
}
