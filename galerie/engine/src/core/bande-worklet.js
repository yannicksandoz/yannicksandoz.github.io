/**
 * LA BANDE — ToTape6, d'Airwindows.
 *
 * D'après **ToTape6** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Le pleurage interpolé, la bosse de tête et son biquad, l'adoucissement des
 * aigus, l'étage « mojo », l'UnBox et l'écrêteur ADClip sont les siens.
 *
 * POURQUOI, APRÈS TOUT LE RESTE. La chaîne sait déjà colorer (la table), et
 * elle sait déjà tenir un plafond (le limiteur). Ce qu'elle ne sait pas
 * faire, c'est ne pas être PARFAITE. Un mixage fait chez soi sonne numérique
 * moins par sa couleur que par sa stabilité : rien ne bouge, rien ne pèse,
 * rien ne cède. La bande apporte les trois d'un coup —
 *
 *   • LE PLEURAGE : la vitesse de défilement n'est pas constante, et le
 *     signal est relu d'un tampon à une position qui oscille. C'est une
 *     modulation de HAUTEUR, pas un effet posé dessus, et c'est ce que
 *     l'oreille reconnaît comme « ce n'est pas un ordinateur » ;
 *   • LA BOSSE DE TÊTE : une résonance dans le bas, non linéaire (l'état
 *     est cubé puis passé au sinus), qui donne du poids à ce qui n'en a
 *     pas ;
 *   • L'ÉCRASEMENT : le « mojo » de Chris — `sin(x·|x|^¼·π/2) / |x|^¼` —
 *     qui aplatit très doucement bien avant d'écrêter, là où un écrêteur
 *     numérique tient tout droit puis coupe net.
 *
 * OÙ, DANS LA CHAÎNE. Après la couleur du bus, avant l'hygiène. La bande est
 * le dernier étage de caractère : ce qu'elle fabrique en haut de bande est
 * ensuite borné, et le plafond reste le dernier mot.
 *
 * DEUX ÉCARTS ASSUMÉS, tous deux dus au dither non porté :
 *   1. le hasard du pleurage. Chris tire son `flutterrandy` de l'état du
 *      générateur du dither ; comme on ne porte pas le dither, on tire d'un
 *      xorshift à nous, semé une fois pour toutes. Le pleurage est donc
 *      REPRODUCTIBLE d'une visite à l'autre — ce qui n'est pas un défaut ici
 *      et rend le portage éprouvable ;
 *   2. `NonHighsSample`, que Chris calcule et n'utilise jamais dans cette
 *      version, n'est pas porté. Le garder n'aurait rien changé au son et
 *      aurait fait croire à un oubli.
 */

/** Le nombre d'or de Chris : la douceur de l'écrêteur ADClip. */
const DOUCEUR = 0.618033988749894848204586;
/** Le plafond de l'écrêteur, un cheveu sous un. */
const PLAFOND = 0.99;
const QUART_DE_TOUR = 1.57079633;

export class ToTape6 {
  constructor(taux) {
    this.taux = taux > 0 ? taux : 48000;
    this.echelle = this.taux / 44100.0;
    // le tampon du pleurage : cinq cents cases, comme chez Chris
    this.ligne = [new Float64Array(501), new Float64Array(501)];
    this.compteur = 0;
    // le pleurage : une vitesse qui dérive vers une cible retirée au hasard
    this.vitesse = 0.5;
    this.balayage = Math.PI;
    this.cible = 0.5;
    this.graine = 2463534242 >>> 0;   // voir l'en-tête : notre propre hasard
    // deux jeux de mémoires, alternés à chaque échantillon (`bascule`)
    this.rouleauA = new Float64Array(2);
    this.rouleauB = new Float64Array(2);
    this.bosseA = new Float64Array(2);
    this.bosseB = new Float64Array(2);
    // les quatre biquads, deux états chacun, par canal : [x][canal][2]
    this.biq = [0, 1, 2, 3].map(() => [new Float64Array(2), new Float64Array(2)]);
    this.bascule = false;
    this.dernier = new Float64Array(2);
    this._allume = false;
    this._accorder();
  }

  /**
   * Les deux passe-bande de Chris, en forme directe II transposée.
   *
   * Leurs Q sont minuscules (0,0009 et 0,0007), donc ce sont des cloches
   * très LARGES et non des pointes : la bosse de tête est une pesée, pas une
   * résonance qu'on entendrait siffler.
   */
  _accorder() {
    const faire = (f0, q) => {
      const f = f0 / this.echelle;
      const K = Math.tan(Math.PI * f);
      const norm = 1.0 / (1.0 + (K / q) + (K * K));
      const b0 = (K / q) * norm;
      // b1 vaut zéro : c'est un passe-bande, et Chris laisse la case à zéro
      return [b0, 0, -b0, 2.0 * ((K * K) - 1.0) * norm,
        (1.0 - (K / q) + (K * K)) * norm];
    };
    this.coefBosse = faire(0.007, 0.0009);    // ≈ 309 Hz : la bosse de tête
    this.coefSignal = faire(0.032, 0.0007);   // ≈ 1,4 kHz : le corps
    this.bosseHz = 0.12 / this.echelle;
  }

  vider() {
    for (const l of this.ligne) l.fill(0);
    this.compteur = 0;
    this.vitesse = 0.5;
    this.balayage = Math.PI;
    this.cible = 0.5;
    this.graine = 2463534242 >>> 0;
    this.rouleauA.fill(0); this.rouleauB.fill(0);
    this.bosseA.fill(0); this.bosseB.fill(0);
    for (const b of this.biq) { b[0].fill(0); b[1].fill(0); }
    this.bascule = false;
    this.dernier.fill(0);
  }

  /** Un xorshift à nous, faute du générateur du dither (voir l'en-tête). */
  _hasard() {
    let x = this.graine;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.graine = x;
    return x / 4294967295;
  }

  /** Un biquad en forme directe II transposée, sur un échantillon. */
  static _passer(coef, etat, x) {
    const temp = (x * coef[0]) + etat[0];
    etat[0] = (x * coef[1]) - (temp * coef[3]) + etat[1];
    etat[1] = (x * coef[2]) - (temp * coef[4]);
    return temp;
  }

  /** Une bande qu'on rallume repart de rien — sinon elle recrache l'avant. */
  _armer(allume) {
    if (allume !== this._allume) { this.vider(); this._allume = allume; }
  }

  /**
   * `entree` et `sortie` : ±12 dB autour de la moitié. `douceur` : combien
   * l'aigu s'écrase. `bosse` : le poids de la tête. `pleurage` : combien la
   * vitesse dérive. `melange` : la part traitée.
   */
  traiter(gauche, droite, entree, douceur, bosse, pleurage, sortie, melange) {
    this._armer(true);
    const b = (v) => Math.min(1, Math.max(0, v));
    const gainE = 10 ** (((b(entree) - 0.5) * 24.0) / 20.0);
    const gainS = 10 ** (((b(sortie) - 0.5) * 24.0) / 20.0);
    const roulis = (1.0 - ((b(douceur) ** 2) * 0.45)) / this.echelle;
    const poids = b(bosse) * 0.25 * gainE;
    const profondeur = (b(pleurage) ** 2) * this.echelle * 70;
    const finesse = (0.0024 * (b(pleurage) ** 2)) / this.echelle;
    const part = b(melange);
    const mono = droite === gauche;
    const canaux = mono ? [gauche] : [gauche, droite];

    for (let n = 0; n < gauche.length; n++) {
      const secs = [gauche[n], mono ? gauche[n] : droite[n]];
      const x = [secs[0], secs[1]];

      for (let c = 0; c < canaux.length; c++) if (gainE < 1.0) x[c] *= gainE;

      /* — LE PLEURAGE : on relit le tampon à une position qui oscille — */
      if (this.compteur < 0 || this.compteur > 499) this.compteur = 499;
      for (let c = 0; c < canaux.length; c++) this.ligne[c][this.compteur] = x[c];
      if (profondeur !== 0.0) {
        const ecart = profondeur
          + (profondeur * (this.vitesse ** 2) * Math.sin(this.balayage));
        const entier = Math.floor(ecart);
        const frac = ecart - entier;
        let i = this.compteur + entier;
        const a = i > 499 ? i - 500 : i;
        i += 1;
        const bIdx = i > 499 ? i - 500 : i;
        for (let c = 0; c < canaux.length; c++) {
          x[c] = (this.ligne[c][a] * (1 - frac)) + (this.ligne[c][bIdx] * frac);
        }
        // la vitesse dérive vers sa cible ; à chaque tour, une nouvelle cible
        this.vitesse = (this.vitesse * (1.0 - finesse)) + (this.cible * finesse);
        this.balayage += this.vitesse * finesse;
        if (this.balayage >= Math.PI * 2.0) {
          this.balayage -= Math.PI;
          this.cible = 0.24 + (this._hasard() * 0.74);
        }
      }
      this.compteur--;

      for (let c = 0; c < canaux.length; c++) {
        const secVibre = x[c];
        const rouleau = this.bascule ? this.rouleauA : this.rouleauB;
        const bosseEtat = this.bascule ? this.bosseA : this.bosseB;
        const iBosse = this.bascule ? 0 : 1;
        const iSignal = this.bascule ? 2 : 3;

        /* — ce qui dépasse du rouleau : l'aigu, qu'on adoucira plus bas — */
        rouleau[c] = (rouleau[c] * (1.0 - roulis)) + (x[c] * roulis);
        const aigus = x[c] - rouleau[c];

        /* — LA BOSSE DE TÊTE : un intégrateur cubé, puis une cloche large — */
        bosseEtat[c] += x[c] * 0.05;
        bosseEtat[c] -= (bosseEtat[c] ** 3) * this.bosseHz;
        bosseEtat[c] = Math.sin(bosseEtat[c]);
        bosseEtat[c] = ToTape6._passer(this.coefBosse, this.biq[iBosse][c], bosseEtat[c]);
        bosseEtat[c] = Math.asin(Math.min(1, Math.max(-1, bosseEtat[c])));

        /* — le corps : sinus, cloche, arc sinus — */
        x[c] = Math.sin(x[c]);
        x[c] = ToTape6._passer(this.coefSignal, this.biq[iSignal][c], x[c]);
        x[c] = Math.asin(Math.min(1, Math.max(-1, x[c])));

        // UnBox : ce que les deux étages ont ÔTÉ, gardé de côté pour être
        // rendu à la toute fin. C'est ce qui empêche la bande de boucher.
        const reste = secVibre - x[c];
        if (gainE > 1.0) x[c] *= gainE;

        /* — l'adoucissement, selon le signe de l'aigu — */
        let adoucir = Math.min(QUART_DE_TOUR, Math.abs(aigus) * QUART_DE_TOUR);
        adoucir = 1 - Math.cos(adoucir);
        if (aigus > 0) x[c] -= adoucir;
        if (aigus < 0) x[c] += adoucir;

        // on bride la bosse pour qu'elle ne s'installe pas en résonance
        const brider = (1.0 - Math.abs(x[c])) * 0.00013;
        for (const etat of [this.bosseA, this.bosseB]) {
          if (etat[c] > brider) etat[c] -= brider;
          else if (etat[c] < -brider) etat[c] += brider;
        }
        x[c] += (this.bosseA[c] + this.bosseB[c]) * poids;

        /* — LE MOJO : ça s'aplatit très tôt, et très doucement — */
        x[c] = Math.min(1, Math.max(-1, x[c]));
        const mojo = Math.abs(x[c]) ** 0.25;
        if (mojo > 0.0) x[c] = Math.sin(x[c] * mojo * Math.PI * 0.5) / mojo;

        x[c] += reste;                       // UnBox rendu
        if (gainS !== 1.0) x[c] *= gainS;

        /* — ADClip : un écrêteur qui regarde l'échantillon d'avant — */
        const d = this.dernier;
        if (d[c] >= PLAFOND) {
          d[c] = x[c] < PLAFOND
            ? (PLAFOND * DOUCEUR) + (x[c] * (1.0 - DOUCEUR)) : PLAFOND;
        }
        if (d[c] <= -PLAFOND) {
          d[c] = x[c] > -PLAFOND
            ? (-PLAFOND * DOUCEUR) + (x[c] * (1.0 - DOUCEUR)) : -PLAFOND;
        }
        if (x[c] > PLAFOND) {
          x[c] = d[c] < PLAFOND
            ? (PLAFOND * DOUCEUR) + (d[c] * (1.0 - DOUCEUR)) : PLAFOND;
        }
        if (x[c] < -PLAFOND) {
          x[c] = d[c] > -PLAFOND
            ? (-PLAFOND * DOUCEUR) + (d[c] * (1.0 - DOUCEUR)) : -PLAFOND;
        }
        d[c] = x[c];
        x[c] = Math.min(PLAFOND, Math.max(-PLAFOND, x[c]));   // la barre de fer

        if (part !== 1.0) x[c] = (x[c] * part) + (secs[c] * (1.0 - part));
      }
      this.bascule = !this.bascule;

      gauche[n] = x[0];
      if (!mono) droite[n] = x[1];
    }
  }

  /** Éteinte : on passe tout droit, mais on note qu'on dort. */
  dormir() { this._armer(false); }
}

class BandeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'actif', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'entree', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'douceur', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bosse', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pleurage', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sortie', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'melange', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new ToTape6(sampleRate);
    this.vivant = true;
    this.port.onmessage = (e) => {
      if (e.data?.arret) this.vivant = false;
      if (e.data?.vider) this.moteur.vider();
    };
  }

  process(entrees, sorties, parametres) {
    const entree = entrees[0];
    const sortie = sorties[0];
    if (!sortie || !sortie.length) return this.vivant;
    // Le tampon du pleurage tient cinq cents échantillons, soit dix
    // millisecondes : ce n'est pas une queue, et il n'y a rien à entretenir
    // quand l'entrée se tait.
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    if (parametres.actif[0] > 0.5) {
      this.moteur.traiter(g, d, parametres.entree[0], parametres.douceur[0],
        parametres.bosse[0], parametres.pleurage[0], parametres.sortie[0],
        parametres.melange[0]);
    } else {
      this.moteur.dormir();
    }
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-bande', BandeProcessor);
