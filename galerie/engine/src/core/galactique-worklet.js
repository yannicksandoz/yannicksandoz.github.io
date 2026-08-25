/**
 * LE GRAND ESPACE — Galactic2, d'Airwindows.
 *
 * D'après **Galactic2** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les seize longueurs, les matrices de Householder, le conditionnement non
 * linéaire de la contre-réaction, les seuils d'assombrissement et l'étage de
 * sortie sont les siens.
 *
 * POURQUOI UN SECOND MOTEUR DE QUEUE. Verbity fait des PIÈCES : un volume
 * fermé, une queue qui décroît, des murs qu'on devine. C'est ce qu'il faut
 * pour un labo ou une bibliothèque, et c'est faux pour ce qui n'est pas une
 * pièce — un belvédère de cinquante mètres à ciel ouvert, un jardin sous les
 * étoiles. Là, il n'y a pas de mur qui renvoie : il y a de l'espace, et le
 * son s'y perd sans jamais vraiment rebondir.
 *
 * Galactic2 est cela : un seul jeu de longueurs, mais énorme — « 290 ms, un
 * stade de dix mille places », cherché comme les autres (« Scarcity, 1 in
 * 55796 »). Et surtout une CONTRE-RÉACTION QUI SE NOURRIT : les quatre
 * gains de retour ne sont pas constants, ils grandissent avec ce qui les
 * traverse (`sin(|x|·4) · x⁴`, borné) et se rabotent d'un passe-haut dont le
 * dosage suit ce même état. C'est ce qui fait qu'à durée maximale la queue
 * ne meurt pas : elle s'installe, se referme sur elle-même et devient un
 * lieu. Une réverbe de pièce ne sait pas faire ça, et ne doit pas.
 *
 * Les deux canaux échangent : le premier retour de gauche vient de la
 * DROITE, celui de droite vient de la gauche, et les deux sont moyennés.
 * L'espace est commun aux deux oreilles — c'est un dehors, pas deux salles.
 *
 * Non porté : le dither, comme partout ailleurs ici. Non porté non plus, le
 * mélange sec/traité (`Wetness`) : le montage de la galerie est un
 * départ/retour, le direct n'est jamais touché, et ce worklet ne rend que la
 * part traitée.
 */

/** Les seize longueurs de Chris, à 44,1 kHz — 290 ms, stade de 10 004 places. */
const LONGUEURS = [683, 2339, 2381, 887, 743, 1823, 1151, 2833,
  521, 3331, 2851, 1747, 3389, 83, 443, 3221];

/* Les deux parcours : le gauche va A→P dans l'ordre, le droit croise. */
const GAUCHE = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
const DROITE = [[3, 7, 11, 15], [2, 6, 10, 14], [1, 5, 9, 13], [0, 4, 8, 12]];

/** Les seuils d'assombrissement : chacun allume un lissage de plus. */
const SEUILS_ENTREE = [0.858, 0.660, 0.462, 0.264, 0.066];
const SEUILS_SORTIE = [0.924, 0.726, 0.528, 0.330, 0.132];

export class Galactic2 {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    this.cycleFin = Math.max(1, Math.min(4, Math.floor(this.echelle)));
    this.cycle = 0;
    this.lignesG = new Array(16);
    this.lignesD = new Array(16);
    this.compteG = new Int32Array(16);
    this.compteD = new Int32Array(16);
    this.longueurs = Int32Array.from(LONGUEURS);
    for (let k = 0; k < 16; k++) {
      this.lignesG[k] = new Float64Array(LONGUEURS[k] + 2);
      this.lignesD[k] = new Float64Array(LONGUEURS[k] + 2);
      this.compteG[k] = 1;
      this.compteD[k] = 1;
    }
    this.fbG = new Float64Array(4);      // AL, BL, CL, DL → vers A, B, C, D
    this.fbD = new Float64Array(4);      // DR, HR, LR, PR → vers D, H, L, P
    // LES QUATRE GAINS DE RETOUR PARTENT DE UN, pas du plancher du clamp.
    // C'est tout sauf un détail : ils ne peuvent que descendre (le sinus de
    // Chris devient négatif au-delà de π, quand la boucle chauffe), et le
    // clamp bas n'est qu'un garde-fou. Les initialiser en bas, comme je
    // l'avais fait, démarrait la contre-réaction quarante décibels trop bas
    // et la queue mourait comme celle d'une pièce ordinaire — mesuré : −39 dB
    // à cinq secondes au lieu de tenir. Le portage entier tenait à ce 1.0.
    this.gains = new Float64Array([1, 1, 1, 1]);
    this.iir = new Float64Array(8);      // A…H
    this.entree = new Float64Array(10);  // 5 lissages × 2 canaux
    this.milieu = new Float64Array(10);  // A, B, C, D, E × 2
    this.sortie = new Float64Array(10);
    this.finale = new Float64Array(10);
    this.refG = new Float64Array(5);
    this.refD = new Float64Array(5);
  }

  vider() {
    for (let k = 0; k < 16; k++) {
      this.lignesG[k].fill(0); this.lignesD[k].fill(0);
      this.compteG[k] = 1; this.compteD[k] = 1;
    }
    this.fbG.fill(0); this.fbD.fill(0);
    this.gains.fill(1);
    this.iir.fill(0);
    this.entree.fill(0); this.milieu.fill(0);
    this.sortie.fill(0); this.finale.fill(0);
    this.refG.fill(0); this.refD.fill(0);
    this.cycle = 0;
  }

  _etage(lignes, compte, indices, entrees, sorties) {
    for (let k = 0; k < 4; k++) lignes[indices[k]][compte[indices[k]]] = entrees[k];
    for (let k = 0; k < 4; k++) {
      const i = indices[k];
      compte[i]++;
      if (compte[i] < 0 || compte[i] > this.longueurs[i]) compte[i] = 0;
    }
    for (let k = 0; k < 4; k++) sorties[k] = lignes[indices[k]][compte[indices[k]]];
  }

  static _croiser(o, sortie) {
    sortie[0] = o[0] - (o[1] + o[2] + o[3]);
    sortie[1] = o[1] - (o[0] + o[2] + o[3]);
    sortie[2] = o[2] - (o[0] + o[1] + o[3]);
    sortie[3] = o[3] - (o[0] + o[1] + o[2]);
  }

  /**
   * Un lissage à une case, allumé seulement au-dessus de son seuil — c'est
   * ainsi que Chris assombrit : non pas un filtre qu'on tourne, mais des
   * étages qu'on ALLUME l'un après l'autre.
   */
  static _lisser(memoire, i, valeur, allume) {
    if (!allume) { memoire[i] = valeur; return valeur; }
    const moyenne = (valeur + memoire[i]) * 0.5;
    memoire[i] = valeur;
    return moyenne;
  }

  /**
   * `poussee` : ce qu'on envoie dans l'espace (0 à 1, la puissance quatre de
   * Chris). `duree` : combien la queue s'installe. `sombre` : le nombre
   * d'étages de lissage allumés. Rend la part traitée seule.
   */
  traiter(gauche, droite, poussee, duree, sombre) {
    const mono = droite === gauche;
    const gain = Math.min(1, Math.max(0, poussee)) ** 4;
    // la contre-réaction : la puissance quatre INVERSÉE de Chris, ×0,063
    const regen = (1.0 - ((1.0 - Math.min(1, Math.max(0, duree))) ** 4)) * 0.063;
    const etages = Math.min(1, Math.max(0, sombre));
    const a = this._a ??= new Float64Array(4);
    const b = this._b ??= new Float64Array(4);
    const c = this._c ??= new Float64Array(4);
    const d = this._d ??= new Float64Array(4);

    for (let n = 0; n < gauche.length; n++) {
      let g = gauche[n];
      let dr = mono ? g : droite[n];

      this.cycle++;
      if (this.cycle === this.cycleFin) {
        if (gain < 1.0) { g *= gain; dr *= gain; }

        /* — les cinq lissages d'entrée — */
        for (let k = 0; k < 5; k++) {
          const allume = etages > SEUILS_ENTREE[k];
          g = Galactic2._lisser(this.entree, k * 2, g, allume);
          dr = Galactic2._lisser(this.entree, (k * 2) + 1, dr, allume);
        }

        /* — le conditionnement des retours : ils GRANDISSENT — */
        // deux paires (CL/LR puis DL/PR), chacune avec son gain qui monte
        // avec ce qui la traverse, puis un passe-haut dont le dosage suit
        // ce même gain. C'est ce qui fait tenir la queue au lieu de la
        // laisser mourir.
        for (let p = 0; p < 2; p++) {
          const iG = p === 0 ? 2 : 3;          // fbG : CL puis DL
          const iD = p === 0 ? 2 : 3;          // fbD : LR puis PR
          const gaucheG = p * 2, gaucheD = (p * 2) + 1;
          this.fbG[iG] *= 0.0625; this.fbD[iD] *= 0.0625;
          this.gains[gaucheG] = Math.min(1, Math.max(0.0078125, this.gains[gaucheG]));
          this.gains[gaucheD] = Math.min(1, Math.max(0.0078125, this.gains[gaucheD]));
          this.fbG[iG] *= this.gains[gaucheG];
          this.fbD[iD] *= this.gains[gaucheD];
          const monteeG = Math.abs(this.fbG[iG] * 4);
          const monteeD = Math.abs(this.fbD[iD] * 4);
          this.gains[gaucheG] += Math.sin(monteeG > 1 ? 4 : monteeG) * (this.fbG[iG] ** 4);
          this.gains[gaucheD] += Math.sin(monteeD > 1 ? 4 : monteeD) * (this.fbD[iD] ** 4);
          this.fbG[iG] *= 16.0; this.fbD[iD] *= 16.0;
        }
        // les passe-haut, un par gain : ils ôtent le continu que la boucle
        // accumulerait sans fin
        const passeHaut = (gainIdx, retours, cible, iirIdx) => {
          const dose = ((this.gains[gainIdx] - 1.0) * -0.00007) + 0.00001;
          this.iir[iirIdx] = (this.iir[iirIdx] * (1.0 - dose)) + (retours[cible] * dose);
          retours[cible] -= this.iir[iirIdx];
        };
        passeHaut(0, this.fbG, 2, 0);   // gain A → CL
        passeHaut(0, this.fbG, 0, 4);   // gain A → AL
        passeHaut(1, this.fbD, 2, 1);   // gain B → LR
        passeHaut(1, this.fbD, 0, 5);   // gain B → DR
        passeHaut(2, this.fbG, 3, 2);   // gain C → DL
        passeHaut(2, this.fbG, 1, 6);   // gain C → BL
        passeHaut(3, this.fbD, 3, 3);   // gain D → PR
        passeHaut(3, this.fbD, 1, 7);   // gain D → HR

        /* — les quatre étages — */
        for (let k = 0; k < 4; k++) {
          a[k] = g + (this.fbG[k] * regen);
          b[k] = dr + (this.fbD[k] * regen);
        }
        this._etage(this.lignesG, this.compteG, GAUCHE[0], a, c);
        this._etage(this.lignesD, this.compteD, DROITE[0], b, d);
        // les lissages du milieu, à leurs seuils, sur les sorties de Chris
        c[1] = Galactic2._lisser(this.milieu, 0, c[1], etages > 0.792);
        d[1] = Galactic2._lisser(this.milieu, 1, d[1], etages > 0.792);
        c[2] = Galactic2._lisser(this.milieu, 8, c[2], etages > 0.990);
        d[2] = Galactic2._lisser(this.milieu, 9, d[2], etages > 0.990);
        Galactic2._croiser(c, a);
        Galactic2._croiser(d, b);
        this._etage(this.lignesG, this.compteG, GAUCHE[1], a, c);
        this._etage(this.lignesD, this.compteD, DROITE[1], b, d);
        c[1] = Galactic2._lisser(this.milieu, 2, c[1], etages > 0.594);
        d[1] = Galactic2._lisser(this.milieu, 3, d[1], etages > 0.594);
        Galactic2._croiser(c, a);
        Galactic2._croiser(d, b);
        this._etage(this.lignesG, this.compteG, GAUCHE[2], a, c);
        this._etage(this.lignesD, this.compteD, DROITE[2], b, d);
        c[1] = Galactic2._lisser(this.milieu, 4, c[1], etages > 0.396);
        d[1] = Galactic2._lisser(this.milieu, 5, d[1], etages > 0.396);
        Galactic2._croiser(c, a);
        Galactic2._croiser(d, b);
        this._etage(this.lignesG, this.compteG, GAUCHE[3], a, c);
        this._etage(this.lignesD, this.compteD, DROITE[3], b, d);
        c[1] = Galactic2._lisser(this.milieu, 6, c[1], etages > 0.198);
        d[1] = Galactic2._lisser(this.milieu, 7, d[1], etages > 0.198);

        /* — les retours, et l'ÉCHANGE entre les deux oreilles — */
        const versD = c[0] - (c[1] + c[2] + c[3]);
        const versG = d[0] - (d[1] + d[2] + d[3]);
        const commun = (versD + versG) * 0.5;
        this.fbD[0] = commun;      // le retour de droite vient de la gauche…
        this.fbG[0] = commun;      // …et réciproquement : l'espace est un seul
        this.fbG[1] = c[1] - (c[0] + c[2] + c[3]);
        this.fbD[1] = d[1] - (d[0] + d[2] + d[3]);
        this.fbG[2] = c[2] - (c[0] + c[1] + c[3]);
        this.fbD[2] = d[2] - (d[0] + d[1] + d[3]);
        this.fbG[3] = c[3] - (c[0] + c[1] + c[2]);
        this.fbD[3] = d[3] - (d[0] + d[1] + d[2]);

        let vG = (c[0] + c[1] + c[2] + c[3]) / 8.0;
        let vD = (d[0] + d[1] + d[2] + d[3]) / 8.0;
        for (let k = 0; k < 5; k++) {
          const allume = etages > SEUILS_SORTIE[k];
          vG = Galactic2._lisser(this.sortie, k * 2, vG, allume);
          vD = Galactic2._lisser(this.sortie, (k * 2) + 1, vD, allume);
        }

        const rG = this.refG, rD = this.refD;
        if (this.cycleFin === 4) {
          rG[0] = rG[4]; rG[2] = (rG[0] + vG) / 2; rG[1] = (rG[0] + rG[2]) / 2;
          rG[3] = (rG[2] + vG) / 2; rG[4] = vG;
          rD[0] = rD[4]; rD[2] = (rD[0] + vD) / 2; rD[1] = (rD[0] + rD[2]) / 2;
          rD[3] = (rD[2] + vD) / 2; rD[4] = vD;
        } else if (this.cycleFin === 3) {
          rG[0] = rG[3]; rG[2] = (rG[0] + rG[0] + vG) / 3;
          rG[1] = (rG[0] + vG + vG) / 3; rG[3] = vG;
          rD[0] = rD[3]; rD[2] = (rD[0] + rD[0] + vD) / 3;
          rD[1] = (rD[0] + vD + vD) / 3; rD[3] = vD;
        } else if (this.cycleFin === 2) {
          rG[0] = rG[2]; rG[1] = (rG[0] + vG) / 2; rG[2] = vG;
          rD[0] = rD[2]; rD[1] = (rD[0] + vD) / 2; rD[2] = vD;
        } else { rG[0] = vG; rD[0] = vD; }
        this.cycle = 0;
      }
      let sG = this.refG[this.cycle];
      let sD = this.refD[this.cycle];

      /* — l'étage de sortie : l'arc sinus rapide de Chris — */
      // c'est lui qui empêche l'espace de partir en fumée quand la
      // contre-réaction s'emballe : au-delà, ça se tasse au lieu de croître
      sG *= 0.5; sD *= 0.5;
      sG = Math.min(2, Math.max(-2, sG));
      sD = Math.min(2, Math.max(-2, sD));
      sG = sG > 0 ? (sG * 2.0) / (2.8274333882308 - sG)
        : -(sG * -2.0) / (2.8274333882308 + sG);
      sD = sD > 0 ? (sD * 2.0) / (2.8274333882308 - sD)
        : -(sD * -2.0) / (2.8274333882308 + sD);

      for (let k = 0; k < 5; k++) {
        const allume = etages > SEUILS_SORTIE[k];
        sG = Galactic2._lisser(this.finale, k * 2, sG, allume);
        sD = Galactic2._lisser(this.finale, (k * 2) + 1, sD, allume);
      }
      sG = Math.min(2, Math.max(-2, sG));
      sD = Math.min(2, Math.max(-2, sD));

      gauche[n] = sG;
      if (!mono) droite[n] = sD;
    }
  }
}

class GalactiqueProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'poussee', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'duree', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sombre', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Galactic2(sampleRate);
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
    if (!entree || !entree.length) {
      // RIEN EN ENTRÉE N'EST PAS RIEN À FAIRE. Le navigateur ne remet pas de
      // canal d'entrée quand ce qui arrive est muet — et une réverbe qui
      // s'arrête de calculer là s'éteint net à la première seconde de
      // silence. C'est tout le contraire de ce qu'on lui demande : la queue
      // est justement ce qui reste QUAND l'entrée s'est tue. On met donc zéro
      // à l'entrée du moteur, et on le fait tourner quand même.
      for (const canal of sortie) canal.fill(0);
    } else {
      sortie[0].set(entree[0]);
      if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    }
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    this.moteur.traiter(g, d, parametres.poussee[0], parametres.duree[0],
      parametres.sombre[0]);
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-galactique', GalactiqueProcessor);
