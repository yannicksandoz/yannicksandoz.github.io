/**
 * LE PUPITRE — Channel9, d'Airwindows.
 *
 * D'après **Channel9** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les cinq jeux de constantes, le passe-haut « diélectrique », la saturation
 * Spiral, l'écrêtage de pente au nombre d'or et les deux biquads sont les
 * siens.
 *
 * CE QU'UNE TABLE FAIT VRAIMENT. On croit qu'une console « colore », comme
 * si elle ajoutait quelque chose. Elle enlève : elle n'arrive pas à suivre.
 * Le cœur de ce portage est un ÉCRÊTAGE DE PENTE — un seuil sur ce que le
 * signal a le droit de bouger d'un échantillon au suivant. Une SSL suit
 * presque tout (0,85), et c'est ce qu'on appelle propre. Une Neve suit deux
 * fois moins vite (0,33) : les attaques s'arrondissent, et l'on appelle cela
 * du corps. Une Teac et une Mackie ne suivent presque rien (0,15 et 0,09) —
 * elles étalent tout, et c'est exactement le son d'un enregistrement fait
 * dans une chambre.
 *
 * POURQUOI ICI. Une galerie de sons faits chez soi n'a aucune raison de
 * sonner comme un studio de Londres, et elle peut choisir de le dire. Le
 * pupitre est le seul étage de la chaîne qui soit un PARTI PRIS et non une
 * correction : c'est pour cela qu'il est éteint par défaut, et qu'il se
 * choisit par son nom.
 *
 * OÙ, DANS LA CHAÎNE. Après le décodage de la console, avant l'hygiène et le
 * limiteur. Une table est ce qui reçoit la somme, pas ce qui la fabrique ;
 * et sa saturation produit de l'ultrasonique, qu'Ultrasonic nettoie juste
 * derrière. Le plafond, lui, reste le dernier.
 *
 * Non porté : le dither, comme partout ailleurs ici. Non porté non plus, le
 * bruit anti-dénormal sur l'entrée — on garde les remises à zéro de Chris
 * sur les mémoires, qui coûtent le même temps et n'ajoutent rien au signal.
 */

/* Les cinq tables — DUPLIQUÉES de pupitre-reglages.js, parce qu'un worklet
   ne peut rien importer : il est exécuté comme texte dans le fil audio.
   `test-pupitre.mjs` vérifie que les deux listes ne divergent jamais. */
const TABLES = [
  { dielectrique: 0.005832, vitesse: 0.33362176, bande: 28811 },  // Neve
  { dielectrique: 0.004096, vitesse: 0.59969536, bande: 27216 },  // API
  { dielectrique: 0.004913, vitesse: 0.84934656, bande: 23011 },  // SSL
  { dielectrique: 0.009216, vitesse: 0.149, bande: 18544 },       // Teac
  { dielectrique: 0.011449, vitesse: 0.092, bande: 19748 }        // Mackie
];

/** Le nombre d'or et son inverse — les deux Q, et les poids de l'écrêtage. */
const PHI = 1.618033988749894848204586;
const UN_SUR_PHI = 0.618033988749894848204586;
const RESTE = 0.381966011250105;          // 1 − 1/φ
/** Au-delà, `sin` est redescendu : c'est le maximum de la sinusoïde de Chris. */
const PLEIN = 1.2533141373155;
const QUART_DE_TOUR = 1.57079633;

export class Channel9 {
  constructor(taux) {
    this.taux = taux > 0 ? taux : 48000;
    this.echelle = this.taux / 44100.0;
    // deux biquads en forme directe I : x1, x2, y1, y2 par canal
    this.biA = new Float64Array(8);
    this.biB = new Float64Array(8);
    this.coefA = null;
    this.coefB = null;
    this.appliqueA = false;
    this.appliqueB = false;
    this._table = -1;
    // le passe-haut diélectrique : DEUX mémoires par canal, alternées
    this.iirA = new Float64Array(2);
    this.iirB = new Float64Array(2);
    this.bascule = false;
    // les trois derniers échantillons, par canal, pour l'écrêtage de pente
    this.dernierA = new Float64Array(2);
    this.dernierB = new Float64Array(2);
    this.dernierC = new Float64Array(2);
    this._allume = false;
  }

  vider() {
    this.biA.fill(0); this.biB.fill(0);
    this.iirA.fill(0); this.iirB.fill(0);
    this.dernierA.fill(0); this.dernierB.fill(0); this.dernierC.fill(0);
    this.bascule = false;
  }

  /**
   * Les coefficients des deux passe-bas, Q = φ puis 1/φ.
   *
   * LE FILTRE EST SAUTÉ AU-DESSUS DE LA MOITIÉ DU TAUX. C'est le
   * `< 0,49999` de Chris, et ce n'est pas une précaution : à 44,1 kHz, les
   * bandes des trois tables chères (28,8 / 27,2 / 23,0 kHz) tombent toutes
   * au-dessus, et aucune ne limite quoi que ce soit. Seules la Teac et la
   * Mackie rétrécissent vraiment — ce qui est précisément ce qui les
   * distingue le plus à ce taux-là.
   */
  _accorder(indice) {
    if (indice === this._table) return;
    this._table = indice;
    const t = TABLES[indice];
    const f = t.bande / this.taux;
    this.appliqueA = f < 0.49999;
    this.appliqueB = f < 0.49999;
    const faire = (q) => {
      const K = Math.tan(Math.PI * f);
      const norm = 1.0 / (1.0 + (K / q) + (K * K));
      const b0 = K * K * norm;
      return [b0, 2.0 * b0, b0,
        2.0 * ((K * K) - 1.0) * norm, (1.0 - (K / q) + (K * K)) * norm];
    };
    // au-dessus de Nyquist, `tan` part en vrille : on ne calcule rien qu'on
    // n'appliquera pas
    this.coefA = this.appliqueA ? faire(PHI) : null;
    this.coefB = this.appliqueB ? faire(UN_SUR_PHI) : null;
  }

  /** Un biquad en forme directe I, sur un échantillon d'un canal. */
  static _passer(coef, etat, c, x) {
    const b = c * 4;
    const y = (coef[0] * x) + (coef[1] * etat[b]) + (coef[2] * etat[b + 1])
      - (coef[3] * etat[b + 2]) - (coef[4] * etat[b + 3]);
    etat[b + 1] = etat[b];
    etat[b] = x;
    const s = Math.abs(y) < 1.18e-37 ? 0 : y;
    etat[b + 3] = etat[b + 2];
    etat[b + 2] = s;
    return s;
  }

  /** Un pupitre qu'on rallume repart de rien — sinon il recrache l'avant. */
  _armer(allume) {
    if (allume !== this._allume) { this.vider(); this._allume = allume; }
  }

  /**
   * `table` : l'indice dans TABLES. `attaque` : le Drive de Chris (0 à 1).
   * `sortie` : le niveau de sortie (0 à 1). Traite sur place.
   */
  traiter(gauche, droite, table, attaque, sortie) {
    this._armer(true);
    const indice = Math.min(TABLES.length - 1, Math.max(0, Math.round(table) || 0));
    const t = TABLES[indice];
    this._accorder(indice);
    const dielectrique = t.dielectrique / this.echelle;
    const seuil = t.vitesse;   // « we've learned not to adjust for sample rate »
    let densite = Math.min(1, Math.max(0, attaque)) * 2.0;
    const rondeur = Math.max(0, densite - 1.0);
    if (densite > 1.0) densite = 1.0;
    const nonLin = 5.0 - densite;
    const mono = droite === gauche;
    const canaux = mono ? [gauche] : [gauche, droite];

    for (let n = 0; n < gauche.length; n++) {
      for (let c = 0; c < canaux.length; c++) {
        let x = canaux[c][n];

        /* — la bande de la table — */
        if (this.appliqueA) x = Channel9._passer(this.coefA, this.biA, c, x);

        /* — le passe-haut DIÉLECTRIQUE : sa vitesse dépend du niveau — */
        // C'est ce qui fait qu'une table ne sonne pas pareil fort et doux :
        // le grave qu'elle laisse passer bouge avec ce qu'on lui envoie.
        const echelle = Math.abs(2.0 - ((x + nonLin) / nonLin));
        const memoire = this.bascule ? this.iirA : this.iirB;
        if (Math.abs(memoire[c]) < 1.18e-37) memoire[c] = 0;
        memoire[c] = (memoire[c] * (1.0 - (dielectrique * echelle)))
          + (x * dielectrique * echelle);
        x -= memoire[c];

        /* — la saturation Spiral, dosée par l'attaque — */
        const sec = x;
        if (x > 1.0) x = 1.0;
        if (x < -1.0) x = -1.0;
        const rond = Math.sin(x * QUART_DE_TOUR);
        x *= PLEIN;
        const abs = Math.abs(x);
        const tordu = abs === 0 ? 0 : Math.sin(x * abs) / abs;
        x = tordu;
        if (densite < 1.0) x = (sec * (1 - densite)) + (tordu * densite);
        if (rondeur > 0.0) x = (x * (1 - rondeur)) + (rond * rondeur);

        /* — L'ÉCRÊTAGE DE PENTE, le cœur de l'affaire — */
        // On ne compare pas à l'échantillon d'avant mais à une pente lissée
        // au nombre d'or : c'est ce qui distingue une table d'un simple
        // écrêteur de pente, et ce qui l'empêche de siffler sur un aigu.
        let pente = (this.dernierB[c] - this.dernierC[c]) * RESTE;
        pente -= (this.dernierA[c] - this.dernierB[c]) * UN_SUR_PHI;
        pente += x - this.dernierA[c];
        this.dernierC[c] = this.dernierB[c];
        this.dernierB[c] = this.dernierA[c];
        this.dernierA[c] = x;
        if (pente > seuil) x = this.dernierB[c] + seuil;
        if (-pente > seuil) x = this.dernierB[c] - seuil;
        // la mémoire garde la moitié du chemin entre le brut et l'écrêté
        this.dernierA[c] = (this.dernierA[c] * RESTE) + (x * UN_SUR_PHI);

        if (sortie < 1.0) x *= sortie;
        if (this.appliqueB) x = Channel9._passer(this.coefB, this.biB, c, x);
        canaux[c][n] = x;
      }
      // la bascule est PAR ÉCHANTILLON, pas par canal : les deux mémoires du
      // passe-haut s'alternent, ce qui lui donne sa finesse
      this.bascule = !this.bascule;
    }
  }

  /** Éteint : on passe tout droit, mais on note qu'on dort. */
  dormir() { this._armer(false); }
}

class PupitreProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'actif', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'table', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'attaque', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sortie', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Channel9(sampleRate);
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
    // Pas de queue à entretenir : sans entrée on rend du silence, et les
    // mémoires gardent ce qu'elles avaient — le signal qui revient reprend
    // la suite au lieu de recommencer.
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    sortie[0].set(entree[0]);
    if (sortie.length > 1) sortie[1].set(entree.length > 1 ? entree[1] : entree[0]);
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    if (parametres.actif[0] > 0.5) {
      this.moteur.traiter(g, d, parametres.table[0], parametres.attaque[0],
        parametres.sortie[0]);
    } else {
      this.moteur.dormir();
    }
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-pupitre', PupitreProcessor);
