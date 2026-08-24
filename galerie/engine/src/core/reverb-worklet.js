/**
 * LA RÉVERBÉRATION DES PIÈCES — Verbity, d'Airwindows.
 *
 * D'après **Verbity** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Portage en JavaScript pour AudioWorklet ; les longueurs de retard (3407,
 * 1823, 859, 331 · 4801, 2909, 1153, 461 · 7607, 4217, 2269, 1597), les
 * coefficients et la structure sont ceux de Chris.
 *
 * POURQUOI ICI. La galerie compte quinze pièces : un labo, un jardin sec à
 * ciel ouvert, une bibliothèque, un belvédère de cinquante mètres. Elles
 * sonnaient toutes pareil — c'est-à-dire nulle part. La spatialisation dit
 * OÙ est une source ; la réverbération dit DANS QUOI. Sans elle, une œuvre
 * est un son posé sur du vide, et passer une porte ne s'entend pas.
 *
 * LA STRUCTURE. Trois blocs de quatre lignes de retard, chacun suivi d'une
 * matrice de Householder — `sortie − (les trois autres)`. C'est ce qui
 * disperse : au troisième bloc, une impulsion est devenue un nuage. La
 * sortie du troisième reboucle sur l'entrée du premier (`regen`), et c'est
 * cette boucle qui fait la durée. Deux passe-bas d'un pôle, un à l'entrée et
 * un à la sortie, donnent la matière du lieu : pierre nue ou tenture.
 *
 * Le `thunder` de Chris — une contre-réaction très lente sur la première
 * ligne — empêche la boucle de s'emballer dans les graves quand on tient la
 * durée longtemps. Il est porté tel quel : sans lui, une pièce réglée large
 * et longue finit par gronder.
 *
 * DÉPART / RETOUR. On force `wetness` au maximum : ce worklet ne rend QUE la
 * queue. Le direct n'y entre jamais — il va au maître par sa propre tranche.
 * C'est ce qui permet de doser la pièce sans toucher au niveau des œuvres.
 *
 * Non porté, et pourquoi : le dither 32 bits, comme ailleurs — la sortie va
 * au mélangeur du navigateur, en flottant.
 */

/* Tailles maximales : `taille` va jusqu'à 1,87, et Chris dimensionne ses
   tampons un peu au-dessus. On alloue une fois pour toutes, pour que
   changer de pièce ne demande jamais de réallouer dans le fil audio. */
const TAILLES = {
  I: 6479, J: 3659, K: 1719, L: 679,
  A: 9699, B: 5999, C: 2319, D: 939,
  E: 15219, F: 8459, G: 4539, H: 3199
};
const BASE = {
  I: 3407, J: 1823, K: 859, L: 331,
  A: 4801, B: 2909, C: 1153, D: 461,
  E: 7607, F: 4217, G: 2269, H: 1597
};
const LIGNES = ['I', 'J', 'K', 'L', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export class Verbity {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    this.cycleFin = Math.max(1, Math.min(4, Math.floor(this.echelle)));
    this.cycle = 0;

    this.ligne = {};
    for (const nom of LIGNES) {
      this.ligne[nom] = {
        g: new Float64Array(TAILLES[nom]), d: new Float64Array(TAILLES[nom]),
        compteur: 0, retard: Math.floor(BASE[nom])
      };
    }
    // les quatre voies de contre-réaction, par canal
    this.retour = { g: [0, 0, 0, 0], d: [0, 0, 0, 0] };
    this.avant = { g: [0, 0, 0, 0], d: [0, 0, 0, 0] };
    this.tonnerre = [0, 0];
    this.iirA = [0, 0];
    this.iirB = [0, 0];
    this.dernier = { g: new Float64Array(5), d: new Float64Array(5) };
  }

  /** Vide la queue — changer de pièce ne doit pas traîner l'ancienne. */
  vider() {
    for (const nom of LIGNES) {
      this.ligne[nom].g.fill(0); this.ligne[nom].d.fill(0);
      this.ligne[nom].compteur = 0;
    }
    this.retour.g.fill(0); this.retour.d.fill(0);
    this.avant.g.fill(0); this.avant.d.fill(0);
    this.tonnerre = [0, 0];
    this.iirA = [0, 0]; this.iirB = [0, 0];
    this.dernier.g.fill(0); this.dernier.d.fill(0);
    this.cycle = 0;
  }

  /**
   * A = taille (l'ampleur du lieu), B = durée (la contre-réaction),
   * C = sombre (l'amortissement des aigus). Le mélange n'est pas ici : ce
   * worklet ne rend que la queue.
   */
  traiter(gauche, droite, A, B, C) {
    const taille = (A * 1.77) + 0.1;
    const regen = 0.0625 + (B * 0.03125);
    const passeBas = (1.0 - (C * C)) / Math.sqrt(this.echelle);
    const interpoler = (C * C) * 0.618033988749894848204586;
    const tonnerreQuantite = (0.3 - (B * 0.22)) * C * 0.1;

    for (const nom of LIGNES) {
      const r = Math.floor(BASE[nom] * taille);
      this.ligne[nom].retard = Math.max(1, Math.min(TAILLES[nom] - 1, r));
    }
    const L = this.ligne;
    const cycleFin = this.cycleFin;

    for (let i = 0; i < gauche.length; i++) {
      let g = gauche[i];
      let d = droite[i];

      // filtre d'entrée : c'est déjà la matière du lieu
      this.iirA[0] = (this.iirA[0] * (1 - passeBas)) + (g * passeBas);
      this.iirA[1] = (this.iirA[1] * (1 - passeBas)) + (d * passeBas);
      g = this.iirA[0]; d = this.iirA[1];

      this.cycle++;
      if (this.cycle === cycleFin) {
        // lissage de la contre-réaction — « des qualités d'IIR », dit Chris
        for (let k = 0; k < 4; k++) {
          this.retour.g[k] = (this.retour.g[k] * (1 - interpoler))
            + (this.avant.g[k] * interpoler);
          this.avant.g[k] = this.retour.g[k];
          this.retour.d[k] = (this.retour.d[k] * (1 - interpoler))
            + (this.avant.d[k] * interpoler);
          this.avant.d[k] = this.retour.d[k];
        }
        this.tonnerre[0] = (this.tonnerre[0] * 0.99)
          - (this.retour.g[0] * tonnerreQuantite);
        this.tonnerre[1] = (this.tonnerre[1] * 0.99)
          - (this.retour.d[0] * tonnerreQuantite);

        // premier bloc : l'entrée plus la contre-réaction
        const entrer = (nom, k, tonnerre) => {
          const l = L[nom];
          l.g[l.compteur] = g + ((this.retour.g[k] + (tonnerre ? this.tonnerre[0] : 0)) * regen);
          l.d[l.compteur] = d + ((this.retour.d[k] + (tonnerre ? this.tonnerre[1] : 0)) * regen);
        };
        entrer('I', 0, true); entrer('J', 1, false);
        entrer('K', 2, false); entrer('L', 3, false);

        const avancer = (noms) => {
          const sorties = [];
          for (const nom of noms) {
            const l = L[nom];
            l.compteur++;
            if (l.compteur < 0 || l.compteur > l.retard) l.compteur = 0;
            sorties.push([l.g[l.compteur], l.d[l.compteur]]);
          }
          return sorties;
        };
        const s1 = avancer(['I', 'J', 'K', 'L']);

        // Householder : chaque ligne moins la somme des trois autres. C'est
        // ce qui disperse une impulsion en nuage.
        const disperser = (source, noms) => {
          for (let k = 0; k < 4; k++) {
            const l = L[noms[k]];
            let sg = source[k][0];
            let sd = source[k][1];
            for (let j = 0; j < 4; j++) {
              if (j === k) continue;
              sg -= source[j][0]; sd -= source[j][1];
            }
            l.g[l.compteur] = sg; l.d[l.compteur] = sd;
          }
        };
        disperser(s1, ['A', 'B', 'C', 'D']);
        const s2 = avancer(['A', 'B', 'C', 'D']);
        disperser(s2, ['E', 'F', 'G', 'H']);
        const s3 = avancer(['E', 'F', 'G', 'H']);

        for (let k = 0; k < 4; k++) {
          let rg = s3[k][0];
          let rd = s3[k][1];
          for (let j = 0; j < 4; j++) {
            if (j === k) continue;
            rg -= s3[j][0]; rd -= s3[j][1];
          }
          this.retour.g[k] = rg; this.retour.d[k] = rd;
        }

        g = (s3[0][0] + s3[1][0] + s3[2][0] + s3[3][0]) / 8;
        d = (s3[0][1] + s3[1][1] + s3[2][1] + s3[3][1]) / 8;

        // Interpolation quand on calcule la réverbe moins souvent que le
        // son : les échantillons manquants sont reconstruits, pas répétés.
        const ref = (memoire, valeur) => {
          if (cycleFin === 4) {
            memoire[0] = memoire[4];
            memoire[2] = (memoire[0] + valeur) / 2;
            memoire[1] = (memoire[0] + memoire[2]) / 2;
            memoire[3] = (memoire[2] + valeur) / 2;
            memoire[4] = valeur;
          } else if (cycleFin === 3) {
            memoire[0] = memoire[3];
            memoire[2] = (memoire[0] + memoire[0] + valeur) / 3;
            memoire[1] = (memoire[0] + valeur + valeur) / 3;
            memoire[3] = valeur;
          } else if (cycleFin === 2) {
            memoire[0] = memoire[2];
            memoire[1] = (memoire[0] + valeur) / 2;
            memoire[2] = valeur;
          } else {
            memoire[0] = valeur;
          }
        };
        ref(this.dernier.g, g);
        ref(this.dernier.d, d);
        this.cycle = 0;
      }
      g = this.dernier.g[this.cycle];
      d = this.dernier.d[this.cycle];

      // filtre de sortie
      this.iirB[0] = (this.iirB[0] * (1 - passeBas)) + (g * passeBas);
      this.iirB[1] = (this.iirB[1] * (1 - passeBas)) + (d * passeBas);

      gauche[i] = this.iirB[0];
      droite[i] = this.iirB[1];
    }
  }
}

class ReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'taille', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'duree', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sombre', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Verbity(sampleRate);
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
      // Rien en entrée : la QUEUE doit continuer de sonner, sinon couper le
      // départ couperait net la réverbération au lieu de la laisser mourir.
      for (const canal of sortie) canal.fill(0);
    } else {
      sortie[0].set(entree[0]);
      if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    }
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    this.moteur.traiter(g, d, parametres.taille[0], parametres.duree[0],
      parametres.sombre[0]);
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-reverb', ReverbProcessor);
