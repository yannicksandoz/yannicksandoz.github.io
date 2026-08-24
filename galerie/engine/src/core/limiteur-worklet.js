/**
 * LE LIMITEUR — Pressure4 puis ClipOnly2, dans le fil audio.
 *
 * D'après les plugins **Airwindows** de Chris Johnson, publiés sous licence
 * MIT (https://github.com/airwindows/airwindows) :
 *
 *   Pressure4  — Copyright (c) 2016 airwindows, Airwindows uses the MIT license
 *   ClipOnly2  — Copyright (c) 2018 airwindows, Airwindows uses the MIT license
 *
 * Portage en JavaScript pour AudioWorklet ; l'algorithme, les coefficients et
 * les constantes sont ceux de Chris. Le crédit n'est pas une politesse : la
 * galerie refuse de publier une œuvre dont l'attribution est incomplète, et
 * ce qu'elle exige des autres, elle se l'applique.
 *
 * POURQUOI UN LIMITEUR DANS UNE GALERIE SONORE. Approcher une œuvre montait
 * son volume, et c'était tout : quinze sources qui s'additionnent saturent la
 * sortie, et l'approche ne s'entend que comme « plus fort ». Un limiteur
 * change la nature du geste — le maître tient son plafond, et le son dont on
 * s'approche prend la place des autres, qui reculent d'autant. La proximité
 * devient une PRÉSENCE et non un volume. C'est le vieux réflexe du mixage :
 * ce qui compresse le bus est ce qui commande le bus.
 *
 * Deux étages, dans cet ordre :
 *
 *   1. **Pressure4**, un vari-µ : sa constante de temps dépend du signal
 *      lui-même (« la vitesse suit la matière »), ce qui lui donne cette
 *      respiration que n'a aucun compresseur à attaque/relâchement fixes.
 *      C'est lui qui fait le mixage proche/lointain.
 *   2. **ClipOnly2**, un écrêteur qui NE FAIT RIEN tant que rien ne dépasse.
 *      Quand un échantillon passe le plafond, il adoucit celui d'avant et
 *      celui d'après au lieu de le trancher — la sécurité du bus, sans le
 *      grain de verre du clipping numérique.
 *
 * Ce qui n'a pas été porté, et pourquoi : le dither 32 bits de Chris. Il
 * prépare une sortie vers un hôte à profondeur fixe ; ici la sortie va vers
 * le mélangeur du navigateur, en flottant, et un générateur pseudo-aléatoire
 * par échantillon coûterait sans rien apporter.
 */

/* Les deux étages sont EXPORTÉS — un module de worklet reste un module ES,
   et l'export y est sans effet. Il permet de les éprouver au nœud, hors
   navigateur : un limiteur qui déborde ne s'entend pas, il se mesure.       */

/* ---------------------------------------------------------- Pressure4 --- */

export class Pressure4 {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    this.muSpeedA = 10000;
    this.muSpeedB = 10000;
    this.muCoefficientA = 1;
    this.muCoefficientB = 1;
    this.flip = false;
    this.moindre = 1;      // le coefficient le plus bas du bloc : la réduction
  }

  /**
   * A = pression (seuil), B = vitesse (relâchement), C = douceur (mewiness),
   * D = sortie. Traitement lié : les deux canaux subissent la MÊME réduction,
   * sans quoi l'image stéréo se déplacerait à chaque crête.
   */
  traiter(gauche, droite, A, B, C, D) {
    const seuil = 1.0 - (A * 0.95);
    const gainMakeup = 1.0 / seuil;
    const release = Math.pow(1.28 - B, 5) * 32768.0 / this.echelle;
    const plusRapide = Math.sqrt(release);

    let mewiness = (C * 2.0) - 1.0;
    let positivemu = true;
    if (mewiness < 0) { positivemu = false; mewiness = -mewiness; }
    const unmewiness = 1.0 - mewiness;

    this.moindre = 1;
    for (let i = 0; i < gauche.length; i++) {
      let g = gauche[i] * gainMakeup;
      let d = droite[i] * gainMakeup;

      // on prend le plus fort des deux canaux, et l'on applique le résultat
      // aux deux
      let sensibilite = Math.abs(g);
      if (Math.abs(d) > sensibilite) sensibilite = Math.abs(d);

      let coefficient;
      if (this.flip) {
        if (sensibilite > seuil) {
          const muVary = seuil / sensibilite;
          const muAttack = Math.sqrt(Math.abs(this.muSpeedA));
          this.muCoefficientA = this.muCoefficientA * (muAttack - 1.0);
          this.muCoefficientA += (muVary < seuil) ? seuil : muVary;
          this.muCoefficientA = this.muCoefficientA / muAttack;
        } else {
          this.muCoefficientA = this.muCoefficientA
            * ((this.muSpeedA * this.muSpeedA) - 1.0);
          this.muCoefficientA = (this.muCoefficientA + 1.0)
            / (this.muSpeedA * this.muSpeedA);
        }
        let nouvelle = this.muSpeedA * (this.muSpeedA - 1);
        nouvelle = nouvelle + Math.abs(sensibilite * release) + plusRapide;
        this.muSpeedA = nouvelle / this.muSpeedA;

        coefficient = positivemu
          ? this.muCoefficientA * this.muCoefficientA
          : Math.sqrt(this.muCoefficientA);
        coefficient = (coefficient * mewiness) + (this.muCoefficientA * unmewiness);
      } else {
        if (sensibilite > seuil) {
          const muVary = seuil / sensibilite;
          const muAttack = Math.sqrt(Math.abs(this.muSpeedB));
          this.muCoefficientB = this.muCoefficientB * (muAttack - 1.0);
          this.muCoefficientB += (muVary < seuil) ? seuil : muVary;
          this.muCoefficientB = this.muCoefficientB / muAttack;
        } else {
          this.muCoefficientB = this.muCoefficientB
            * ((this.muSpeedB * this.muSpeedB) - 1.0);
          this.muCoefficientB = (this.muCoefficientB + 1.0)
            / (this.muSpeedB * this.muSpeedB);
        }
        let nouvelle = this.muSpeedB * (this.muSpeedB - 1);
        nouvelle = nouvelle + Math.abs(sensibilite * release) + plusRapide;
        this.muSpeedB = nouvelle / this.muSpeedB;

        coefficient = positivemu
          ? this.muCoefficientB * this.muCoefficientB
          : Math.sqrt(this.muCoefficientB);
        coefficient = (coefficient * mewiness) + (this.muCoefficientB * unmewiness);
      }
      this.flip = !this.flip;

      if (coefficient < this.moindre) this.moindre = coefficient;
      g *= coefficient;
      d *= coefficient;
      if (D !== 1.0) { g *= D; d *= D; }

      // second étage de surcharge : au-delà de π/2 la sinusoïde plafonne à 1
      let redresse = Math.abs(g);
      redresse = redresse > 1.57079633 ? 1.0 : Math.sin(redresse);
      g = g > 0 ? redresse : -redresse;
      redresse = Math.abs(d);
      redresse = redresse > 1.57079633 ? 1.0 : Math.sin(redresse);
      d = d > 0 ? redresse : -redresse;

      gauche[i] = g;
      droite[i] = d;
    }
  }
}

/* ---------------------------------------------------------- ClipOnly2 --- */

const PLAFOND = 0.9549925859;
const DURETE = 0.7390851;     // cos(x) = x, la constante de Chris
const DOUCEUR = 0.2609148;    // 1 - dureté
const PENTE = 0.7058208;
const REPRISE = 0.2491717;

export class ClipOnly2 {
  constructor(taux) {
    // le retard suit le taux d'échantillonnage : un échantillon à 44,1 kHz
    this.espace = Math.max(1, Math.min(16, Math.floor(taux / 44100)));
    this.dernier = [0, 0];
    this.tampon = [new Float64Array(this.espace + 1), new Float64Array(this.espace + 1)];
    this.ecrete = [{ pos: false, neg: false }, { pos: false, neg: false }];
  }

  traiter(canal, c) {
    const etat = this.ecrete[c];
    const tampon = this.tampon[c];
    for (let i = 0; i < canal.length; i++) {
      let x = canal[i];
      if (x > 4.0) x = 4.0; else if (x < -4.0) x = -4.0;

      if (etat.pos) {   // l'échantillon d'avant a écrêté : on adoucit celui-ci
        this.dernier[c] = (x < this.dernier[c])
          ? PENTE + (x * DOUCEUR)
          : REPRISE + (this.dernier[c] * DURETE);
      }
      etat.pos = false;
      if (x > PLAFOND) { etat.pos = true; x = PENTE + (this.dernier[c] * DOUCEUR); }

      if (etat.neg) {
        this.dernier[c] = (x > this.dernier[c])
          ? -PENTE + (x * DOUCEUR)
          : -REPRISE + (this.dernier[c] * DURETE);
      }
      etat.neg = false;
      if (x < -PLAFOND) { etat.neg = true; x = -PENTE + (this.dernier[c] * DOUCEUR); }

      tampon[this.espace] = x;
      x = this.dernier[c];   // la latence : un échantillon à 44,1 kHz
      for (let k = this.espace; k > 0; k--) tampon[k - 1] = tampon[k];
      this.dernier[c] = tampon[0];
      canal[i] = x;
    }
  }
}

/* ------------------------------------------------------- le processeur --- */

/** Tous les combien la réduction remonte à l'interface (~12 fois/seconde). */
const BLOCS_PAR_MESURE = 4;

class LimiteurProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Les quatre réglages de Pressure4, plus l'interrupteur. En k-rate :
      // ils se règlent à la main, pas au sample près, et les coefficients se
      // recalculent une fois par bloc comme dans l'original.
      { name: 'pression', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'vitesse', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'douceur', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sortie', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'actif', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.pression = new Pressure4(sampleRate);
    this.ecreteur = new ClipOnly2(sampleRate);
    this.blocs = 0;
    this.moindre = 1;
    this.vivant = true;
    this.port.onmessage = (e) => {
      // Un limiteur ne s'arrête jamais de lui-même : sans cela, changer de
      // page laisserait le processeur tourner jusqu'à la fermeture du
      // contexte.
      if (e.data?.arret) this.vivant = false;
    };
  }

  process(entrees, sorties, parametres) {
    const entree = entrees[0];
    const sortie = sorties[0];
    if (!sortie || !sortie.length) return this.vivant;

    // Rien en entrée : on écrit du silence plutôt que de laisser le dernier
    // bloc traîner, et l'on garde le nœud vivant.
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }

    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    g.set(entree[0]);
    if (sortie.length > 1) d.set(entree.length > 1 ? entree[1] : entree[0]);

    if (parametres.actif[0] >= 0.5) {
      this.pression.traiter(g, d, parametres.pression[0], parametres.vitesse[0],
        parametres.douceur[0], parametres.sortie[0]);
      this.ecreteur.traiter(g, 0);
      if (sortie.length > 1) this.ecreteur.traiter(d, 1);
      if (this.pression.moindre < this.moindre) this.moindre = this.pression.moindre;
    } else {
      this.moindre = 1;
    }

    // Les canaux au-delà du second suivent la gauche : une galerie ne mixe
    // qu'en stéréo, et laisser un canal muet ferait un trou dans le champ.
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);

    if (++this.blocs >= BLOCS_PAR_MESURE) {
      this.blocs = 0;
      this.port.postMessage({ reduction: this.moindre });
      this.moindre = 1;
    }
    return this.vivant;
  }
}

registerProcessor('galerie-limiteur', LimiteurProcessor);
