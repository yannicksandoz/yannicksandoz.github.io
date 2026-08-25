/**
 * LA TABLE, VERSION SEPT — Console7, d'Airwindows.
 *
 * D'après **Console7Channel** et **Console7Buss** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les deux mélanges d'harmoniques, les passe-bas à 20 kHz et leurs Q au
 * nombre d'or, et le fader poursuivi sont les siens.
 *
 * CE QUI CHANGE DEPUIS LA SIX. Console6 est une paire de courbes SANS
 * MÉMOIRE, réciproques l'une de l'autre : `x(2−x)` puis son inverse exact.
 * C'est ce qui permet de l'écrire en `WaveShaperNode` natif, et c'est
 * gratuit. La sept n'est pas cela :
 *
 *   • l'encodage mêle DEUX saturations — Spiral à 80 % et la Density de
 *     ConsoleChannel à 20 % — et le décodage en mêle deux autres, à 61,8 et
 *     38,2 %. Ce ne sont plus des réciproques exactes, et c'est voulu : le
 *     déséquilibre est ce qui fait la couleur ;
 *   • chaque étage porte un passe-bas à vingt kilohertz, dont le Q vaut φ à
 *     la tranche et 1/φ puis 0,5 au bus ;
 *   • le fader est POURSUIVI et non posé : `gainchase` rejoint sa cible
 *     d'autant plus vite qu'on vient de la bouger. Un fader qu'on traîne ne
 *     craque pas, et un fader immobile finit exactement sur sa valeur ;
 *   • la tranche saturе au CUBE du fader puis se réamplifie d'un seul
 *     facteur. Une tranche baissée traverse donc moins de distorsion et
 *     ressort « en arrière » dans l'image — Chris écrit « fall back in the
 *     soundstage, subtly ». Dans une galerie où c'est la DISTANCE qui tient
 *     le fader, cela tombe particulièrement bien.
 *
 * Le prix de tout cela : de la mémoire, donc un worklet par tranche là où la
 * six ne demandait qu'une courbe. Voir `Console.js` pour ce que cela coûte,
 * mesuré, et pourquoi la six reste le défaut.
 *
 * Non porté : le dither, comme partout ailleurs ici.
 */

const PHI = 1.618033988749894848204586;
const UN_SUR_PHI = 0.618033988749894848204586;
const RESTE = 0.381966011250105;
/** La racine de φ : le fader de la tranche « va jusqu'à douze ». */
const RACINE_PHI = 1.272019649514069;

/** Un passe-bas de Chris à 20 kHz, en forme directe I. */
function coefficients(taux, q) {
  const f = 20000.0 / (taux > 0 ? taux : 48000);
  const K = Math.tan(Math.PI * f);
  const norm = 1.0 / (1.0 + (K / q) + (K * K));
  const b0 = K * K * norm;
  return [b0, 2.0 * b0, b0, 2.0 * ((K * K) - 1.0) * norm,
    (1.0 - (K / q) + (K * K)) * norm];
}

/** Forme directe I, un échantillon, état [x1, x2, y1, y2] par canal. */
function passer(coef, etat, c, x) {
  const b = c * 4;
  const y = (coef[0] * x) + (coef[1] * etat[b]) + (coef[2] * etat[b + 1])
    - (coef[3] * etat[b + 2]) - (coef[4] * etat[b + 3]);
  etat[b + 1] = etat[b]; etat[b] = x;
  etat[b + 3] = etat[b + 2]; etat[b + 2] = y;
  return y;
}

/**
 * LE FADER POURSUIVI, commun aux deux étages.
 *
 * `vitesse` descend vers soixante-quatre quand rien ne bouge (le fader se
 * pose), et double dès que la cible change (le fader suit la main). C'est
 * exactement ce que fait Chris, et c'est ce qui permet de traîner un curseur
 * sans entendre l'escalier.
 */
class Poursuite {
  constructor() { this.vitesse = 64.0; this.valeur = -1; }
  viser(cible, bloc) {
    if (this.valeur !== cible) this.vitesse *= 2.0;
    if (this.vitesse > bloc) this.vitesse = bloc;
    if (this.valeur < 0) this.valeur = cible;
    this.cible = cible;
  }
  avancer() {
    this.vitesse *= 0.9999;
    this.vitesse -= 0.01;
    if (this.vitesse < 64.0) this.vitesse = 64.0;
    this.valeur = ((this.valeur * this.vitesse) + this.cible) / (this.vitesse + 1.0);
    return this.valeur;
  }
  vider() { this.vitesse = 64.0; this.valeur = -1; }
}

export class Console7Tranche {
  constructor(taux) {
    this.coef = coefficients(taux, PHI);
    this.etat = new Float64Array(8);
    this.fader = new Poursuite();
  }

  vider() { this.etat.fill(0); this.fader.vider(); }

  /** `niveau` : le fader de Chris. 0,772 est son neutre à pleine échelle. */
  traiter(gauche, droite, niveau) {
    const cible = Math.min(1, Math.max(0, niveau)) * RACINE_PHI;
    this.fader.viser(cible, gauche.length);
    const mono = droite === gauche;
    const canaux = mono ? [gauche] : [gauche, droite];
    for (let n = 0; n < gauche.length; n++) {
      const g = this.fader.avancer();
      const cube = g * g * g;
      for (let c = 0; c < canaux.length; c++) {
        let x = passer(this.coef, this.etat, c, canaux[c][n]);
        if (g !== 1.0) x *= cube;
        // le plafond de Chris : 1,097, pas un
        x = Math.min(1.097, Math.max(-1.097, x));
        const abs = Math.abs(x);
        const spirale = abs === 0 ? 0 : Math.sin(x * abs) / abs;
        x = (spirale * 0.8) + (Math.sin(x) * 0.2);
        if (g !== 1.0 && g !== 0.0) x /= g;
        canaux[c][n] = x;
      }
    }
  }
}

export class Console7Somme {
  constructor(taux) {
    this.coefA = coefficients(taux, UN_SUR_PHI);
    this.coefB = coefficients(taux, 0.5);
    this.etatA = new Float64Array(8);
    this.etatB = new Float64Array(8);
    this.fader = new Poursuite();
  }

  vider() { this.etatA.fill(0); this.etatB.fill(0); this.fader.vider(); }

  /** `niveau` : le trim du bus. 0,971 rend un fader exactement à un. */
  traiter(gauche, droite, niveau) {
    const cible = Math.min(1, Math.max(0, niveau)) * 1.03;
    this.fader.viser(cible, gauche.length);
    const mono = droite === gauche;
    const canaux = mono ? [gauche] : [gauche, droite];
    for (let n = 0; n < gauche.length; n++) {
      const g = this.fader.avancer();
      const racine = Math.sqrt(g);
      for (let c = 0; c < canaux.length; c++) {
        let x = passer(this.coefA, this.etatA, c, canaux[c][n]);
        if (g !== 1.0) x *= racine;
        x = Math.min(1, Math.max(-1, x));
        const abs = Math.abs(x);
        const spirale = abs === 0 ? 0 : Math.asin(x * abs) / abs;
        x = (spirale * UN_SUR_PHI) + (Math.asin(x) * RESTE);
        x = passer(this.coefB, this.etatB, c, x);
        if (g !== 1.0) x *= racine;
        canaux[c][n] = x;
      }
    }
  }
}

/** Le squelette commun aux deux processeurs : même entrée, même sortie. */
function faireProcesseur(Moteur, defaut) {
  return class extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: 'niveau', defaultValue: defaut, minValue: 0, maxValue: 1,
        automationRate: 'k-rate' }];
    }

    constructor() {
      super();
      this.moteur = new Moteur(sampleRate);
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
        for (const canal of sortie) canal.fill(0);
        return this.vivant;
      }
      sortie[0].set(entree[0]);
      if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
      const g = sortie[0];
      const d = sortie.length > 1 ? sortie[1] : sortie[0];
      this.moteur.traiter(g, d, parametres.niveau[0]);
      for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
      return this.vivant;
    }
  };
}

registerProcessor('galerie-console7-tranche', faireProcesseur(Console7Tranche, 0.772));
registerProcessor('galerie-console7-somme', faireProcesseur(Console7Somme, 0.971));
