/**
 * L'HYGIÈNE DU MAÎTRE — Ultrasonic et Infrasonic, d'Airwindows.
 *
 * D'après **Ultrasonic** et **Infrasonic** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les deux fréquences, les cinq Q du Butterworth d'ordre dix et la forme
 * directe I sont les siennes.
 *
 * POURQUOI, ALORS QUE PERSONNE N'ENTEND CE QU'ON ENLÈVE. Justement : ce qui
 * s'y trouve n'est pas de la musique, c'est le déchet des étages d'avant.
 * En bas, chaque boucle de réverbe, chaque bloqueur de continu, chaque
 * enveloppe laisse un résidu sous vingt hertz ; il ne s'entend pas, il
 * OCCUPE — il mange de la marge et fait travailler le limiteur sur du vent.
 * En haut, les mises en forme non linéaires de la chaîne (la table Console6,
 * la saturation sinus de Pressure4, l'écrêteur, le conditionnement de
 * Galactic2) fabriquent des harmoniques au-dessus de vingt kilohertz ; le
 * convertisseur d'un casque bon marché les replie en intermodulation, et
 * cela, on l'entend — comme une aigreur qu'on croit venir du mixage.
 *
 * Les deux filtres bornent donc la galerie à ce qu'une oreille peut recevoir,
 * et rendent au reste de la chaîne ce que le hors-bande lui prenait.
 *
 * OÙ, DANS LA CHAÎNE. Avant le limiteur, jamais après. Un plafond doit être
 * le DERNIER mot sur les crêtes : filtrer derrière lui arrondit ce qu'il
 * vient d'écrêter et repousse des échantillons au-dessus du plafond qu'on
 * venait de garantir. On nettoie l'entrée, on limite ensuite.
 *
 * Non porté : le dither, comme partout ailleurs ici. Non porté non plus, le
 * bruit anti-dénormal de Chris (`fpd * 1,18e-17` sur l'entrée) : injecter du
 * bruit pour éviter des nombres lents est un remède de compilateur C. On
 * remet à zéro les mémoires descendues sous 1e-25, ce qui coûte le même
 * temps machine et n'ajoute rien au signal.
 */

/* Les cinq Q d'un Butterworth d'ordre dix — DUPLIQUÉES de
   hygiene-reglages.js, parce qu'un worklet ne peut rien importer : il est
   exécuté comme texte dans le fil audio. `test-hygiene.mjs` vérifie que les
   deux listes ne divergent jamais. */
const Q_BUTTERWORTH = [
  0.50623256, 0.56116312, 0.70710678, 1.10134463, 3.19622661
];
const AIGUS_HZ = 20000;
const GRAVES_HZ = 20;

/** Une mémoire sous ce seuil ne dit plus rien : on l'efface (voir l'en-tête). */
const PLANCHER = 1e-25;

export class Hygiene {
  constructor(taux) {
    this.taux = taux > 0 ? taux : 48000;
    // b0, b1, b2, a1, a2 pour chacun des cinq biquads de chaque filtre
    this.bas = Q_BUTTERWORTH.map((q) => this._coefficients('bas', AIGUS_HZ, q));
    this.haut = Q_BUTTERWORTH.map((q) => this._coefficients('haut', GRAVES_HZ, q));
    // x1, x2, y1, y2 pour cinq biquads × deux canaux, par filtre
    this.etatBas = new Float64Array(5 * 2 * 4);
    this.etatHaut = new Float64Array(5 * 2 * 4);
    this._aigus = true;
    this._graves = true;
  }

  /**
   * La forme de Chris, K = tan(π·f/taux). Voir hygiene-reglages.js pour la
   * borne de coupure et pourquoi elle existe.
   */
  _coefficients(type, hz, q) {
    const f = Math.min(hz, this.taux * 0.46) / this.taux;
    const K = Math.tan(Math.PI * f);
    const norm = 1.0 / (1.0 + (K / q) + (K * K));
    const a1 = 2.0 * ((K * K) - 1.0) * norm;
    const a2 = (1.0 - (K / q) + (K * K)) * norm;
    if (type === 'haut') return [norm, -2.0 * norm, norm, a1, a2];
    const b0 = K * K * norm;
    return [b0, 2.0 * b0, b0, a1, a2];
  }

  vider() { this.etatBas.fill(0); this.etatHaut.fill(0); }

  /**
   * Un filtre qu'on rallume doit repartir de rien.
   *
   * Une mémoire gardée pendant qu'on était contourné contient l'écho de ce
   * qui passait il y a une minute : la rebrancher le recrache d'un coup.
   * C'est le seul clic que ces filtres puissent faire, et il est évitable.
   */
  _armer(aigus, graves) {
    if (aigus !== this._aigus) { this.etatBas.fill(0); this._aigus = aigus; }
    if (graves !== this._graves) { this.etatHaut.fill(0); this._graves = graves; }
  }

  /** Une cascade de cinq biquads en forme directe I, sur un canal. */
  _cascade(coefs, etat, canal, indexCanal) {
    for (let k = 0; k < 5; k++) {
      const [b0, b1, b2, a1, a2] = coefs[k];
      const base = ((k * 2) + indexCanal) * 4;
      let x1 = etat[base], x2 = etat[base + 1];
      let y1 = etat[base + 2], y2 = etat[base + 3];
      for (let n = 0; n < canal.length; n++) {
        const x = canal[n];
        const y = (b0 * x) + (b1 * x1) + (b2 * x2) - (a1 * y1) - (a2 * y2);
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;
        canal[n] = y;
      }
      etat[base] = Math.abs(x1) < PLANCHER ? 0 : x1;
      etat[base + 1] = Math.abs(x2) < PLANCHER ? 0 : x2;
      etat[base + 2] = Math.abs(y1) < PLANCHER ? 0 : y1;
      etat[base + 3] = Math.abs(y2) < PLANCHER ? 0 : y2;
    }
  }

  /** Filtre sur place. `aigus` coupe le haut, `graves` coupe le bas. */
  traiter(gauche, droite, aigus = true, graves = true) {
    this._armer(Boolean(aigus), Boolean(graves));
    const mono = droite === gauche;
    if (graves) {
      this._cascade(this.haut, this.etatHaut, gauche, 0);
      if (!mono) this._cascade(this.haut, this.etatHaut, droite, 1);
    }
    if (aigus) {
      this._cascade(this.bas, this.etatBas, gauche, 0);
      if (!mono) this._cascade(this.bas, this.etatBas, droite, 1);
    }
  }
}

class HygieneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'aigus', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'graves', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Hygiene(sampleRate);
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
    // Ici, contrairement aux réverbes, rien à faire quand l'entrée est
    // muette : ces filtres n'ont pas de queue à entretenir. On rend du
    // silence, et les mémoires gardent ce qu'elles avaient — le retour du
    // signal reprend la suite au lieu de recommencer.
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    this.moteur.traiter(g, d, parametres.aigus[0] > 0.5, parametres.graves[0] > 0.5);
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-hygiene', HygieneProcessor);
