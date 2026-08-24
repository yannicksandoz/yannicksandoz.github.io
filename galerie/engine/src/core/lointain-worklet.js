/**
 * LE LOINTAIN — Distance2, d'Airwindows.
 *
 * D'après **Distance2** de Chris Johnson
 * (© 2016 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Les treize seuils de pente, les coefficients et l'enchaînement sont les
 * siens. Distance2 est lui-même l'hybride de ses plugins *Distance* et
 * *Atmosphere*.
 *
 * POURQUOI, ET CE QU'IL FAIT QUE LE FILTRE D'AIR NE FAIT PAS. La galerie
 * modèle déjà la distance PARCOURUE : un passe-bas par voie dont la coupure
 * tombe quand on s'éloigne (voir `air-reglages.js`). C'est de la physique, et
 * ça suffit pour une œuvre qu'on approche.
 *
 * Ceci est autre chose : une œuvre qu'on n'approchera JAMAIS. Une voix au
 * fond d'un couloir, un orage derrière une colline, quelque chose qui doit
 * rester hors d'atteinte même quand le visiteur est devant. Distance2 fait
 * cela par un moyen que le filtre n'a pas : une cascade de treize LIMITEURS
 * DE PENTE, chacun un peu plus lent que le précédent (0,618 · 0,680 · 0,748…
 * le nombre d'or, monté par pas de dix pour cent). Ils n'atténuent pas
 * l'aigu, ils empêchent le signal de MONTER vite — et c'est exactement ce
 * que l'air fait à un son qui a traversé cent mètres : il en émousse les
 * fronts.
 *
 * UN SEUL RÉGLAGE POUR TROIS. Chris en expose trois — atmosphère, assombrir,
 * mélange sec/traité. Ici, `lointain` monte les deux premiers ENSEMBLE :
 * son avertissement est que l'atmosphère seule, poussée, ne fait pas un son
 * lointain mais « le bruit d'une pression si forte qu'elle romprait l'air et
 * vos tympans » — c'est l'assombrissement qui la ramène au réel.
 *
 * Le mélange, lui, monte DEUX FOIS PLUS VITE et sature à mi-course. Deux
 * raisons, mesurées :
 *
 *   — il faut qu'il parte de zéro. L'algorithme n'est pas transparent à
 *     atmosphère nulle : la pente de repos vaut 0,6, donc le traité est
 *     comparé à une ligne à retard de signal SEC restée, elle, à pleine
 *     échelle — les limiteurs mordent quand même (0,34 d'écart mesuré sur du
 *     bruit). C'est le mélange, et lui seul, qui garantit qu'un `lointain`
 *     nul ne touche à rien ;
 *   — mais il ne faut pas qu'il traîne. Garder du sec au-delà, c'est garder
 *     un son net et brillant à côté du son lointain : l'oreille n'entend
 *     alors pas « loin » mais « faible et proche » — précisément le défaut
 *     qu'on corrige. Passé la mi-course, la part sèche disparaît et l'aigu
 *     tombe pour de bon (100 % → 5 % de la brillance d'origine).
 *
 * CE QUE ÇA COÛTE EN NIVEAU. Les limiteurs de pente n'attaquent que ce qui
 * monte vite : un souffle perd beaucoup, un bourdon grave presque rien. À
 * mi-course, un son riche tombe d'une quinzaine de décibels — c'est l'effet
 * lui-même, pas un défaut, et aucun rattrapage automatique ne serait juste
 * puisqu'il dépend du son. Une œuvre qu'on veut lointaine ET présente se
 * remonte au volume de l'objet.
 *
 * Non porté : le dither, comme partout ailleurs ici.
 *
 * ÉCART ASSUMÉ : un bloqueur de continu. L'étage « offset air compression »
 * de Chris ajoute une composante CONTINUE proportionnelle à l'atmosphère —
 * 0,12 à fond, même sur du silence, mesuré. Dans un plugin posé sur un mix
 * fini, cela se perd. Ici, quinze œuvres se somment dans une console puis un
 * limiteur : quinze continus additionnés mangeraient la marge du maître et
 * rendraient l'écrêtage asymétrique. On coupe donc sous 10 Hz — au-dessous de
 * ce qu'un haut-parleur restitue, et seulement sur la part traitée, pour
 * qu'un mélange à zéro reste l'entrée intacte, échantillon pour échantillon.
 */

/* Les treize seuils de Chris, au repos (44,1 kHz). */
const SEUILS = [
  0.618033988749894, 0.679837387624884, 0.747821126387373, 0.82260323902611,
  0.904863562928721, 0.995349919221593, 1.094884911143752, 1.204373402258128,
  1.32481074248394, 1.457291816732335, 1.603020998405568, 1.763323098246125,
  1.939655408070737
];

export class Distance2 {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    this.seuils = SEUILS.map((s) => s / this.echelle);
    // la ligne à retard du signal SEC, une case par seuil
    this.sec = [new Float64Array(SEUILS.length), new Float64Array(SEUILS.length)];
    this.dernier = [0, 0];    // dernière sortie de l'étage IIR
    this.tiers = [0, 0];
    // bloqueur de continu, 10 Hz (voir l'en-tête)
    this.pole = 1 - ((2 * Math.PI * 10) / taux);
    this.dcE = [0, 0];
    this.dcS = [0, 0];
  }

  vider() {
    this.sec[0].fill(0); this.sec[1].fill(0);
    this.dernier = [0, 0];
    this.tiers = [0, 0];
    this.dcE = [0, 0];
    this.dcS = [0, 0];
  }

  /**
   * A = atmosphère (la rupture de l'air), B = assombrir, C = mélange.
   *
   * Les trois montent ensemble dans la galerie : voir l'en-tête, l'atmosphère
   * seule ne fait pas un lointain.
   */
  traiter(gauche, droite, A, B, C) {
    let pente = ((A ** 3) * 24) + 0.6;
    pente *= this.echelle;
    const filtre = pente * B;
    const second = filtre / 3.0;
    const tiers = filtre / 5.0;
    const decalage = A * 0.1618;
    const correction = 1.0 + ((filtre / 12.0) * A);
    const melange = C;
    const seuils = this.seuils;
    const n = seuils.length;

    for (let c = 0; c < 2; c++) {
      const canal = c === 0 ? gauche : droite;
      if (c === 1 && droite === gauche) break;   // mono : un seul passage
      const sec = this.sec[c];

      for (let i = 0; i < canal.length; i++) {
        const entree = canal[i];
        const decale = decalage - (this.dernier[c] - entree);
        let x = entree + (decale * decalage);
        x *= melange;
        x *= pente;

        // les treize limiteurs de pente, du plus vif au plus lent
        for (let k = 0; k < n; k++) {
          const ecart = x - sec[k];
          if (ecart > seuils[k]) x = sec[k] + seuils[k];
          else if (-ecart > seuils[k]) x = sec[k] - seuils[k];
        }
        // la ligne avance : chaque case garde le signal sec d'il y a k pas
        for (let k = n - 1; k > 0; k--) sec[k] = sec[k - 1];
        sec[0] = entree;

        x *= correction;
        x /= pente;
        x -= decale * decalage;

        // l'étage IIR : ce qui « écrase encore ce qui est très lointain »
        x += this.tiers[c] * tiers;
        x /= tiers + 1.0;
        x += this.dernier[c] * second;
        x /= second + 1.0;

        this.tiers[c] = this.dernier[c];
        this.dernier[c] = x;
        x *= correction;

        // le continu s'en va ici, avant le mélange : à melange = 0, la ligne
        // suivante rend l'entrée telle quelle et rien n'a été touché
        const sansContinu = x - this.dcE[c] + (this.pole * this.dcS[c]);
        this.dcE[c] = x;
        this.dcS[c] = sansContinu;
        x = sansContinu;

        canal[i] = melange !== 1.0 ? (x * melange) + (entree * (1 - melange)) : x;
      }
    }
  }
}

class LointainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lointain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.moteur = new Distance2(sampleRate);
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
    const d = parametres.lointain[0];
    if (d > 0.001) {
      // On repart d'un état propre après un passage à zéro : les cases de la
      // ligne à retard gardent sinon l'échantillon d'il y a une heure, et il
      // claque au retour.
      if (!this._actif) { this.moteur.vider(); this._actif = true; }
      const g = sortie[0];
      const dr = sortie.length > 1 ? sortie[1] : sortie[0];
      // Atmosphère et assombrissement montent ensemble ; le mélange, deux
      // fois plus vite, et il sature à mi-course (voir l'en-tête : c'est lui
      // qui fait partir la course de l'identité, et lui qu'il faut sortir du
      // chemin ensuite).
      this.moteur.traiter(g, dr, d, d, Math.min(1, d * 2));
    } else this._actif = false;
    for (let c = 2; c < sortie.length; c++) sortie[c].set(sortie[0]);
    return this.vivant;
  }
}

registerProcessor('galerie-lointain', LointainProcessor);
