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
const POINTS = 8192;

/** Encodage d'une tranche — Console6Channel. */
export function encoder(x) {
  if (x > 1) return 1;
  if (x > 0) return x * (2 - x);
  if (x < -1) return -1;
  if (x < 0) return x * (x + 2);
  return 0;
}

/** Décodage du bus — Console6Buss, réciproque exacte de l'encodage. */
export function decoder(x) {
  if (x > 1) return 1;
  if (x > 0) return x / (1 + Math.sqrt(1 - x));
  if (x < -1) return -1;
  if (x < 0) return x / (Math.sqrt(x + 1) + 1);
  return 0;
}

function courbe(fn) {
  const c = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i++) c[i] = fn((i / (POINTS - 1)) * 2 - 1);
  return c;
}

export class Console {
  constructor() {
    this.ctx = null;
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
    this.decodeur = ctx.createWaveShaper();
    this.decodeur.curve = this._courbes.decodage;
    // « none » : Console6 est conçue SANS sur-échantillonnage. En ajouter
    // changerait la courbe que Chris a réglée à l'oreille.
    this.decodeur.oversample = 'none';
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
    const encodeur = this.ctx.createWaveShaper();
    encodeur.curve = this._courbes.encodage;
    encodeur.oversample = 'none';
    attenuation.connect(encodeur);
    encodeur.connect(this.somme);
    this.canaux.set(bus, { attenuation, encodeur, coupe: false });
    bus.connect(this.actif ? attenuation : this.somme);
    return bus;
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
    this.actif = r.actif;
    this.attaque = r.attaque;

    if (!this.ctx) return;
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

/**
 * Réglages relus et bornés.
 *
 * ÉTEINTE par défaut, et à pleine attaque quand on l'allume : c'est le
 * réglage de Chris, celui qu'on veut entendre pour juger. À moitié attaque
 * la table s'entend à peine — autant ne pas la brancher.
 */
export const CONSOLE_DEFAUTS = { actif: false, attaque: 1 };

export function normaliserConsole(brut) {
  const c = { ...CONSOLE_DEFAUTS, ...(brut ?? {}) };
  const a = Number(c.attaque);
  return {
    // Seul un `true` franc l'allume : c'est une couleur livrée éteinte, et
    // une valeur douteuse dans un JSON ne doit pas la brancher à l'insu de
    // l'auteur.
    actif: c.actif === true,
    // jamais zéro : ce serait une division par zéro dans le gain de rendu
    attaque: Number.isFinite(a) ? Math.min(1, Math.max(0.05, a)) : CONSOLE_DEFAUTS.attaque
  };
}
