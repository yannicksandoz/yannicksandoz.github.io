/**
 * LE PLAFOND, DERNIÈRE VERSION — Pressure5, d'Airwindows.
 *
 * D'après **Pressure5** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Le compresseur vari-µ et ses deux jeux de coefficients alternés, les deux
 * Butterworth fixes à 24 kHz, la modulation de la courbe par la pente
 * (« PawClaw ») et l'écrêteur ClipOnly2 intégré sont les siens.
 *
 * CE QUE LA CINQ AJOUTE À LA QUATRE. Le limiteur de la galerie était
 * Pressure4 suivi de ClipOnly2, deux étages qu'il fallait accorder l'un à
 * l'autre. La cinq est le tout d'un bloc, et Chris y a mis trois choses que
 * la quatre n'avait pas :
 *
 *   • DEUX PASSE-BAS À 24 kHz, l'un devant la compression, l'autre entre
 *     elle et l'écrêteur. Un détecteur qui voit de l'ultrasonique réagit à
 *     ce que personne n'entend, et un écrêteur qui en reçoit en fabrique
 *     davantage. Les filtrer là est ce qui rend l'écrêtage propre ;
 *   • « PAWCLAW » : la courbe du µ est modulée par la PENTE du signal —
 *     patte de velours sur ce qui bouge doucement, griffe sur ce qui attaque.
 *     C'est le réglage qui décide si le limiteur caresse ou retient ;
 *   • ClipOnly2 EST DEDANS, après le mélange sec/traité, en filet de
 *     sécurité même à mi-mélange.
 *
 * POURQUOI IL RESTE UN CHOIX. La quatre est réglée, éprouvée, et c'est elle
 * qu'on a entendue jusqu'ici. La cinq devient le défaut parce qu'elle est
 * meilleure sur le papier ET mesurée, mais les deux restent accessibles :
 * un plafond se juge à l'oreille sur du vrai contenu, pas sur un argument.
 *
 * ÉCART ASSUMÉ, le même que partout : le dither n'est pas porté. Chris
 * l'utilise aussi comme bruit anti-dénormal sur l'entrée ; on s'en passe.
 */

/** Le nombre d'or : le dosage de PawClaw. */
const PHI = 1.618033988749894848204586;
/** Le seuil de ClipOnly2, et les deux coefficients de sa remontée. */
const SEUIL_CLIP = 0.9549925859;
const CLIP_A = 0.7058208;
const CLIP_B = 0.2609148;
const CLIP_C = 0.2491717;
const CLIP_D = 0.7390851;

export class Pressure5 {
  constructor(taux) {
    this.taux = taux > 0 ? taux : 48000;
    this.echelle = this.taux / 44100.0;
    // Le pas de l'écrêteur : sa latence vaut UN échantillon à 44,1 kHz,
    // donc autant d'échantillons qu'il en faut pour la même durée ici.
    this.pas = Math.min(16, Math.max(1, Math.floor(this.echelle)));
    this._accorder();
    // deux jeux de coefficients, alternés à chaque échantillon
    this.coefA = 1; this.coefB = 1;
    this.vitesseA = 10000; this.vitesseB = 10000;   // les valeurs de Chris
    this.bascule = false;
    this.pente = 0;
    // ClipOnly2 : un petit tampon par canal, plus l'état « ça a débordé »
    this.dernier = new Float64Array(2);
    this.debordePlus = [false, false];
    this.debordeMoins = [false, false];
    this.milieu = [new Float64Array(17), new Float64Array(17)];
    this.reduction = 1;
  }

  /**
   * Les deux passe-bas fixes de Chris, à 24 kHz, Q de Butterworth.
   *
   * SAUTÉS SOUS 48 kHz, et c'est son test à lui (`< 0,4999`) : à 44,1 kHz
   * la coupure tomberait au-dessus de Nyquist. À 48 kHz elle vaut exactement
   * la moitié du taux et ne passe pas non plus. Ils ne travaillent donc qu'à
   * 88,2 kHz et au-delà — ce qui est exactement leur objet, puisque c'est là
   * qu'il y a de l'ultrasonique à ôter.
   */
  _accorder() {
    const f = 24000.0 / this.taux;
    this.applique = f < 0.4999;
    if (!this.applique) { this.coefs = null; return; }
    const q = 0.7071;
    const K = Math.tan(Math.PI * f);
    const norm = 1.0 / (1.0 + (K / q) + (K * K));
    const a0 = K * K * norm;
    this.coefs = [a0, 2.0 * a0, a0,
      2.0 * ((K * K) - 1.0) * norm, (1.0 - (K / q) + (K * K)) * norm];
    // deux filtres, deux états chacun, deux canaux : [filtre][canal][2]
    this.fix = [[new Float64Array(2), new Float64Array(2)],
      [new Float64Array(2), new Float64Array(2)]];
  }

  vider() {
    this.coefA = 1; this.coefB = 1;
    this.vitesseA = 10000; this.vitesseB = 10000;
    this.bascule = false;
    this.pente = 0;
    this.dernier.fill(0);
    this.debordePlus = [false, false];
    this.debordeMoins = [false, false];
    for (const m of this.milieu) m.fill(0);
    this.reduction = 1;
    if (this.applique) {
      for (const f of this.fix) for (const e of f) e.fill(0);
    }
  }

  /** Forme directe II transposée, comme Chris l'écrit ici. */
  _filtrer(i, c, x) {
    const e = this.fix[i][c];
    const k = this.coefs;
    const t = (x * k[0]) + e[0];
    e[0] = (x * k[1]) - (t * k[3]) + e[1];
    e[1] = (x * k[2]) - (t * k[4]);
    return t;
  }

  /** ClipOnly2, sur un canal. Rend l'échantillon RETARDÉ d'un pas. */
  _ecreter(c, x) {
    let v = Math.min(4.0, Math.max(-4.0, x));
    const d = this.dernier;
    if (this.debordePlus[c]) {
      d[c] = v < d[c] ? CLIP_A + (v * CLIP_B) : CLIP_C + (d[c] * CLIP_D);
    }
    this.debordePlus[c] = false;
    if (v > SEUIL_CLIP) { this.debordePlus[c] = true; v = CLIP_A + (d[c] * CLIP_B); }
    if (this.debordeMoins[c]) {
      d[c] = v > d[c] ? -CLIP_A + (v * CLIP_B) : -CLIP_C + (d[c] * CLIP_D);
    }
    this.debordeMoins[c] = false;
    if (v < -SEUIL_CLIP) { this.debordeMoins[c] = true; v = -CLIP_A + (d[c] * CLIP_B); }
    const m = this.milieu[c];
    m[this.pas] = v;
    const rendu = d[c];
    for (let k = this.pas; k > 0; k--) m[k - 1] = m[k];
    d[c] = m[0];
    return rendu;
  }

  /**
   * `pression` : combien il serre. `vitesse` : le relâchement. `caractere` :
   * la « µ-ité » de Chris. `griffe` : patte de velours (0) ou griffe (1),
   * 0,5 au neutre. `sortie` : le niveau. `melange` : la part traitée.
   */
  traiter(gauche, droite, pression, vitesse, caractere, griffe, sortie, melange) {
    const b = (v) => Math.min(1, Math.max(0, v));
    const seuil = 1.0 - (b(pression) * 0.95);
    const rattrapage = 1.0 / seuil;
    let relache = ((1.28 - b(vitesse)) ** 5) * 32768.0;
    let leplusVite = Math.sqrt(relache);
    relache /= this.echelle;
    leplusVite /= this.echelle;
    const miaou = b(caractere);
    const pattes = -(b(griffe) - 0.5) * PHI;
    const gainSortie = (b(sortie) * 2.0) ** 2;
    const part = b(melange);
    const mono = droite === gauche;
    let moindre = 1;

    for (let n = 0; n < gauche.length; n++) {
      const secG = gauche[n];
      const secD = mono ? secG : droite[n];
      let g = secG * rattrapage;
      let d = mono ? g : secD * rattrapage;

      if (this.applique) {
        g = this._filtrer(0, 0, g);
        if (!mono) d = this._filtrer(0, 1, d);
      }

      // LE DÉTECTEUR EST COMMUN AUX DEUX CANAUX, et prend le plus fort : une
      // compression par canal déplacerait l'image stéréo dès qu'un côté
      // travaille plus que l'autre.
      const sens = Math.max(Math.abs(g), Math.abs(d));

      /* — la µ-ité, modulée par la pente du signal (« PawClaw ») — */
      let miaulement = Math.sin(miaou + (this.pente * pattes));
      const positif = miaulement >= 0;
      if (!positif) miaulement = -miaulement;

      /* — le vari-µ de Chris, sur le jeu de coefficients du tour — */
      const surA = this.bascule;
      let coef = surA ? this.coefA : this.coefB;
      let vit = surA ? this.vitesseA : this.vitesseB;
      if (sens > seuil) {
        const ecart = seuil / sens;
        const attaque = Math.sqrt(Math.abs(vit));
        coef *= attaque - 1.0;
        coef += ecart < seuil ? seuil : ecart;
        coef /= attaque;
      } else {
        coef *= (vit * vit) - 1.0;
        coef += 1.0;
        coef /= vit * vit;
      }
      let neuve = vit * (vit - 1);
      neuve += Math.abs(sens * relache) + leplusVite;
      vit = neuve / vit;
      if (surA) { this.coefA = coef; this.vitesseA = vit; }
      else { this.coefB = coef; this.vitesseB = vit; }

      // la courbe : le carré quand la µ-ité est positive, la racine sinon,
      // puis un fondu vers le coefficient brut
      let applique = positif ? coef * coef : Math.sqrt(coef);
      applique = (applique * miaulement) + (coef * (1.0 - miaulement));
      g *= applique;
      if (!mono) d *= applique;
      if (applique < moindre) moindre = applique;

      if (gainSortie !== 1.0) { g *= gainSortie; if (!mono) d *= gainSortie; }
      this.bascule = !this.bascule;

      if (this.applique) {
        g = this._filtrer(1, 0, g);
        if (!mono) d = this._filtrer(1, 1, d);
      }

      if (part !== 1.0) {
        g = (g * part) + (secG * (1.0 - part));
        if (!mono) d = (d * part) + (secD * (1.0 - part));
      }

      // la pente sert AU TOUR SUIVANT : c'est ce qui rend PawClaw réactif
      // sans être instable — il regarde ce qui vient de se passer.
      this.pente = Math.abs(g - this.dernier[0]);
      if (!mono) {
        const autre = Math.abs(d - this.dernier[1]);
        if (autre > this.pente) this.pente = autre;
      }

      gauche[n] = this._ecreter(0, g);
      if (!mono) droite[n] = this._ecreter(1, d);
    }
    // ce que l'afficheur montre : la plus forte réduction du bloc
    this.reduction = moindre;
  }
}

class Pression5Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'actif', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pression', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'vitesse', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'caractere', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'griffe', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sortie', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'melange', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Pressure5(sampleRate);
    this.vivant = true;
    this._compte = 0;
    this.port.onmessage = (e) => {
      if (e.data?.arret) this.vivant = false;
      if (e.data?.vider) this.moteur.vider();
    };
  }

  process(entrees, sorties, parametres) {
    const entree = entrees[0];
    const sortie = sorties[0];
    if (!sortie || !sortie.length) return this.vivant;
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    if (parametres.actif[0] > 0.5) {
      this.moteur.traiter(g, d, parametres.pression[0], parametres.vitesse[0],
        parametres.caractere[0], parametres.griffe[0], parametres.sortie[0],
        parametres.melange[0]);
      // le voyant de réduction : dix fois par seconde suffit à l'œil, et
      // soixante messages par seconde vers le fil principal, non
      if ((this._compte = (this._compte + 1) % 8) === 0) {
        this.port.postMessage({ reduction: this.moteur.reduction });
      }
    }
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-pression5', Pression5Processor);
