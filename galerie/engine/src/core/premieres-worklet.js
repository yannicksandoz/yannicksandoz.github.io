/**
 * LES PREMIÈRES RÉFLEXIONS — ClearCoat, d'Airwindows.
 *
 * D'après **ClearCoat** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les dix-sept jeux de longueurs, les matrices de Householder, l'étage
 * SubTight et l'enchaînement sont les siens.
 *
 * CE QUE VERBITY NE FAIT PAS. La réverbération de la galerie
 * (`reverb-worklet.js`) donne la QUEUE : ce qui reste dans l'air une fois le
 * son passé. C'est ce qu'on entend d'une pièce quand on est loin de la
 * source, ou après elle. Mais collé à une œuvre, une queue ne dit rien —
 * elle est masquée par le direct. Ce qui rend une salle audible DE PRÈS,
 * c'est autre chose : les premiers retours des murs, entre cinq et deux
 * cents millisecondes, assez tôt pour que l'oreille les fonde dans le son
 * lui-même. On n'entend pas une réverbe : on entend que la pièce est petite.
 *
 * DIX-SEPT SALLES, EN PLACES ASSISES. Chris n'a pas réglé ces longueurs, il
 * les a CHERCHÉES : chaque jeu de seize est un tirage retenu sur des
 * centaines de milliers (« Scarcity, 1 in 125324 ») pour que les échos ne
 * retombent jamais les uns sur les autres. Elles vont d'une salle de 96
 * places (5 à 51 ms) à un hall de 1541 (24 à 203 ms) — et c'est là le vrai
 * réglage : on ne choisit pas un temps, on choisit une SALLE.
 *
 * Quatre étages de quatre lignes par canal, chacun mélangé en Householder
 * (chaque sortie moins la somme des trois autres), les deux canaux
 * parcourant les mêmes seize longueurs dans un ordre différent — c'est ce
 * qui fait la largeur sans jamais dédoubler. La contre-réaction vaut 1/24,
 * « exactement à mi-chemin entre le maintien infini et six décibels plus
 * bas » : la queue meurt vite, et c'est voulu.
 *
 * Non porté : le dither, comme partout ailleurs ici. Non porté non plus, le
 * mélange sec/traité de Chris (chez lui, 50 % rend le sec ET le traité à
 * plein pour qu'on puisse en poser sur un sous-groupe sans toucher aux
 * équilibres) : ici le montage est un DÉPART/RETOUR, le direct n'est jamais
 * touché — la même intention, par un autre chemin. Ce worklet ne rend donc
 * que la part traitée.
 */

/**
 * Les dix-sept salles : seize longueurs de ligne (A…P), en échantillons à
 * 44,1 kHz, avec le nombre de places et l'étalement des premiers retours.
 */
export const SALLES = [
  { taps: [65, 124, 83, 180, 200, 291, 108, 189, 73, 410, 479, 310, 11, 928, 23, 654], places: 96, ms: [5, 51] },
  { taps: [114, 205, 498, 195, 205, 318, 143, 254, 64, 721, 512, 324, 11, 782, 26, 394], places: 107, ms: [7, 52] },
  { taps: [118, 272, 292, 145, 200, 241, 204, 504, 50, 678, 424, 412, 11, 1124, 47, 766], places: 135, ms: [8, 58] },
  { taps: [19, 474, 301, 275, 260, 321, 371, 571, 50, 410, 697, 414, 11, 986, 47, 522], places: 143, ms: [7, 61] },
  { taps: [112, 387, 452, 289, 173, 476, 321, 593, 73, 343, 829, 91, 11, 1055, 43, 862], places: 166, ms: [8, 66] },
  { taps: [60, 368, 295, 272, 210, 284, 326, 830, 125, 236, 737, 486, 11, 1178, 75, 902], places: 189, ms: [9, 70] },
  { taps: [73, 311, 472, 251, 134, 509, 393, 591, 124, 1070, 340, 525, 11, 1367, 75, 816], places: 225, ms: [7, 79] },
  { taps: [159, 518, 514, 165, 275, 494, 296, 667, 75, 1101, 116, 414, 11, 1261, 79, 998], places: 252, ms: [11, 80] },
  { taps: [41, 741, 274, 59, 306, 332, 291, 767, 42, 881, 959, 422, 11, 1237, 45, 958], places: 255, ms: [8, 83] },
  { taps: [251, 437, 783, 189, 130, 272, 244, 761, 128, 1190, 320, 491, 11, 1409, 58, 455], places: 323, ms: [10, 93] },
  { taps: [316, 510, 1087, 349, 359, 74, 79, 1269, 34, 693, 749, 511, 11, 1751, 93, 403], places: 427, ms: [9, 110] },
  { taps: [254, 651, 845, 316, 373, 267, 182, 857, 215, 1535, 1127, 315, 11, 1649, 97, 829], places: 470, ms: [15, 110] },
  { taps: [113, 101, 673, 357, 340, 229, 278, 1008, 265, 1890, 155, 267, 11, 2233, 116, 600], places: 606, ms: [11, 131] },
  { taps: [218, 1058, 862, 505, 297, 580, 532, 1387, 120, 576, 1409, 473, 11, 1991, 76, 685], places: 643, ms: [14, 132] },
  { taps: [78, 760, 982, 528, 445, 1128, 130, 708, 22, 2144, 354, 1169, 11, 2782, 58, 1515], places: 809, ms: [5, 159] },
  { taps: [330, 107, 1110, 371, 620, 143, 1014, 1763, 184, 2068, 1406, 595, 11, 2639, 33, 1594], places: 984, ms: [10, 171] },
  { taps: [336, 1660, 386, 623, 693, 1079, 891, 1574, 24, 2641, 1239, 775, 11, 3104, 55, 2366], places: 1541, ms: [24, 203] }
];

/* Les deux parcours : le gauche va A→P dans l'ordre, le droit croise. */
const GAUCHE = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
const DROITE = [[3, 7, 11, 15], [2, 6, 10, 14], [1, 5, 9, 13], [0, 4, 8, 12]];
/** 1/24 : « à mi-chemin entre le maintien infini et six décibels plus bas ». */
const REINJECTION = 0.04166666666;

export class ClearCoat {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    // à 44,1 et 48 kHz : un échantillon de réverbe par échantillon d'entrée.
    // Au-delà, Chris calcule moins souvent et interpole — c'est ce qui garde
    // le coût constant quand la carte son monte à 96 ou 192 kHz.
    this.cycleFin = Math.max(1, Math.min(4, Math.floor(this.echelle)));
    this.cycle = 0;
    this.subRate = 0.001 / this.echelle;
    this.salle = -1;
    this.lignesG = new Array(16);
    this.lignesD = new Array(16);
    this.compteG = new Int32Array(16);
    this.compteD = new Int32Array(16);
    this.longueurs = new Int32Array(16);
    this.fbG = new Float64Array(4);      // vers A, B, C, D
    this.fbD = new Float64Array(4);      // vers D, H, L, P
    this.lisseG = 0; this.lisseD = 0;
    this.refG = new Float64Array(5);
    this.refD = new Float64Array(5);
    this.sub = new Float64Array(8);      // 4 étages × 2 canaux
    this.queueG = 0; this.queueD = 0;
    this.choisir(0);
  }

  /**
   * Change de salle : les longueurs changent, donc les lignes aussi. On les
   * vide — garder l'ancien contenu ferait entendre la salle précédente
   * repliée dans la nouvelle, et ce n'est pas une queue, c'est un artefact.
   */
  choisir(index) {
    const i = Math.max(0, Math.min(SALLES.length - 1, Math.round(index) || 0));
    if (i === this.salle) return;
    this.salle = i;
    const taps = SALLES[i].taps;
    for (let k = 0; k < 16; k++) {
      this.longueurs[k] = taps[k];
      const n = taps[k] + 2;
      if (!this.lignesG[k] || this.lignesG[k].length !== n) {
        this.lignesG[k] = new Float64Array(n);
        this.lignesD[k] = new Float64Array(n);
      } else {
        this.lignesG[k].fill(0);
        this.lignesD[k].fill(0);
      }
      this.compteG[k] = 1;
      this.compteD[k] = 1;
    }
    this.fbG.fill(0); this.fbD.fill(0);
    this.refG.fill(0); this.refD.fill(0);
    this.sub.fill(0);
    this.lisseG = 0; this.lisseD = 0;
    this.queueG = 0; this.queueD = 0;
  }

  vider() {
    const garde = this.salle;
    this.salle = -1;
    this.choisir(garde);
  }

  /** Écrit quatre valeurs dans quatre lignes, avance, et relit. */
  _etage(lignes, compte, indices, entrees, sorties) {
    for (let k = 0; k < 4; k++) lignes[indices[k]][compte[indices[k]]] = entrees[k];
    for (let k = 0; k < 4; k++) {
      const i = indices[k];
      compte[i]++;
      if (compte[i] < 0 || compte[i] > this.longueurs[i]) compte[i] = 0;
    }
    for (let k = 0; k < 4; k++) sorties[k] = lignes[indices[k]][compte[indices[k]]];
  }

  /** Householder : chacun moins la somme des trois autres. */
  static _croiser(o, sortie) {
    sortie[0] = o[0] - (o[1] + o[2] + o[3]);
    sortie[1] = o[1] - (o[0] + o[2] + o[3]);
    sortie[2] = o[2] - (o[0] + o[1] + o[3]);
    sortie[3] = o[3] - (o[0] + o[1] + o[2]);
  }

  /**
   * Rend la part TRAITÉE seule (voir l'en-tête : le sec ne passe pas par
   * ici, c'est un départ/retour). `salle` est l'indice de la salle voulue.
   */
  traiter(gauche, droite, salle) {
    this.choisir(salle);
    const mono = droite === gauche;
    const a = this._a ??= new Float64Array(4);
    const b = this._b ??= new Float64Array(4);
    const c = this._c ??= new Float64Array(4);
    const d = this._d ??= new Float64Array(4);

    for (let n = 0; n < gauche.length; n++) {
      const entreeG = gauche[n];
      const entreeD = mono ? entreeG : droite[n];
      let sortieG, sortieD;

      this.cycle++;
      if (this.cycle === this.cycleFin) {
        /* — un échantillon de réverbe — */
        for (let k = 0; k < 4; k++) {
          a[k] = entreeG + (this.fbG[k] * REINJECTION);
          b[k] = entreeD + (this.fbD[k] * REINJECTION);
        }
        this._etage(this.lignesG, this.compteG, GAUCHE[0], a, c);
        this._etage(this.lignesD, this.compteD, DROITE[0], b, d);
        for (let etage = 1; etage < 4; etage++) {
          ClearCoat._croiser(c, a);
          ClearCoat._croiser(d, b);
          this._etage(this.lignesG, this.compteG, GAUCHE[etage], a, c);
          this._etage(this.lignesD, this.compteD, DROITE[etage], b, d);
        }
        // le premier des quatre derniers passe par un lissage à une case :
        // c'est ce qui empêche le dernier étage de siffler
        let lisse = ((c[0] * 3) + this.lisseG) * 0.25;
        this.lisseG = c[0]; c[0] = lisse;
        lisse = ((d[0] * 3) + this.lisseD) * 0.25;
        this.lisseD = d[0]; d[0] = lisse;

        this.fbG[0] = c[0] - (c[1] + c[2] + c[3]);
        this.fbG[1] = c[1] - (c[0] + c[2] + c[3]);
        this.fbG[2] = c[2] - (c[0] + c[1] + c[3]);
        this.fbG[3] = c[3] - (c[0] + c[1] + c[2]);
        this.fbD[0] = d[0] - (d[1] + d[2] + d[3]);
        this.fbD[1] = d[1] - (d[0] + d[2] + d[3]);
        this.fbD[2] = d[2] - (d[0] + d[1] + d[3]);
        this.fbD[3] = d[3] - (d[0] + d[1] + d[2]);

        // la somme, corrigée du gain de Householder
        let vG = (c[0] + c[1] + c[2] + c[3]) / 8.0;
        let vD = (d[0] + d[1] + d[2] + d[3]) / 8.0;
        if (vG > 1.0) vG = 1.0; else if (vG < -1.0) vG = -1.0;
        if (vD > 1.0) vD = 1.0; else if (vD < -1.0) vD = -1.0;

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
        } else {
          rG[0] = vG; rD[0] = vD;
        }
        this.cycle = 0;
      }
      sortieG = this.refG[this.cycle];
      sortieD = this.refD[this.cycle];

      /* — SubTight : les quatre étages qui ôtent le grondement — */
      let sG = sortieG * this.subRate;
      let sD = sortieD * this.subRate;
      for (let k = 0; k < 4; k++) {
        let ech = 0.5 + Math.abs(sG * 0.5);
        sG = this.sub[k] + (Math.sin(this.sub[k] - sG) * ech);
        this.sub[k] = sG * ech;
        ech = 0.5 + Math.abs(sD * 0.5);
        sD = this.sub[k + 4] + (Math.sin(this.sub[k + 4] - sD) * ech);
        this.sub[k + 4] = sD * ech;
      }
      if (sG > 0.25) sG = 0.25; else if (sG < -0.25) sG = -0.25;
      if (sD > 0.25) sD = 0.25; else if (sD < -0.25) sD = -0.25;
      sortieG -= sG * 16.0;
      sortieD -= sD * 16.0;

      if (this.cycleFin > 1) {
        // on ne moyenne qu'aux taux élevés, là où l'interpolation a laissé
        // des marches
        const mG = (sortieG + this.queueG) * 0.5;
        this.queueG = sortieG; sortieG = mG;
        const mD = (sortieD + this.queueD) * 0.5;
        this.queueD = sortieD; sortieD = mD;
      }

      gauche[n] = sortieG;
      if (!mono) droite[n] = sortieD;
    }
  }
}

class PremieresProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'salle', defaultValue: 6, minValue: 0, maxValue: SALLES.length - 1,
        automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new ClearCoat(sampleRate);
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
      // le départ est vide : la salle finit de résonner, puis se tait
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    // Une entrée mono repart dans DEUX canaux : les deux parcourent les
    // mêmes seize longueurs dans un ordre différent, et c'est de là que
    // vient la largeur de la salle. Les recopier l'un sur l'autre après
    // coup rendrait la pièce monophonique.
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    this.moteur.traiter(g, d, parametres.salle[0]);
    for (let c = 2; c < sortie.length; c++) sortie[c].set(sortie[0]);
    return this.vivant;
  }
}

registerProcessor('galerie-premieres', PremieresProcessor);
