/**
 * L'ÉCOUTE DE CONTRÔLE — Monitoring, d'Airwindows.
 *
 * D'après **Monitoring** de Chris Johnson
 * (© 2018 airwindows, licence MIT — https://github.com/airwindows/airwindows).
 * Portage en JavaScript pour AudioWorklet ; les coefficients, les longueurs
 * d'allpass (149 et 223 échantillons, « des nombres premiers bien espacés »)
 * et les gains sont les siens.
 *
 * POURQUOI. Une galerie binaurale se juge au casque, et au casque on se
 * trompe : on entend une image large et l'on croit avoir mixé. Les modes de
 * contrôle sont des LOUPES — on écoute la galerie autrement pendant trois
 * secondes, on apprend quelque chose, on revient. Ils ne changent jamais ce
 * qui est publié : c'est un outil d'auteur, posé APRÈS le limiteur, tout au
 * bout de la chaîne, là où se pose un casque.
 *
 * Les six loupes, et ce que chacune apprend :
 *
 *   NORMAL   passe-plat, bit à bit — la référence, et le repos ;
 *   MONO     les deux canaux additionnés. Ce qui DISPARAÎT ici s'annulera
 *            sur une enceinte de téléphone : c'est le test de phase ;
 *   CÔTÉ     leur différence seule. Ce qu'on entend est exactement ce que
 *            la spatialisation a fabriqué — sur une source mono mal
 *            panoramiquée, il ne reste rien ;
 *   GRAVES   vingt-six passe-bas en cascade (SubsOnly) : il ne reste que le
 *            très bas. On entend les ronflements et les nappes qui
 *            s'accumulent, que le casque flatte et qu'une salle révèle ;
 *   CRÊTES   PeaksOnly : les transitoires, sans le corps. Pour entendre les
 *            clics, les coupures de boucle et les attaques qui claquent ;
 *   CASQUE   Cans C, la diaphonie de Chris : un peu du canal gauche arrive à
 *            l'oreille droite et inversement, avec le retard et
 *            l'assombrissement d'une vraie tête. C'est ce que des
 *            HAUT-PARLEURS feraient. À écouter pour vérifier qu'un mixage
 *            binaural tient encore quand les oreilles communiquent.
 */

const MODES = ['normal', 'mono', 'cote', 'graves', 'cretes', 'casque'];

/** Un allpass « à la Midiverb », celui que Chris emploie deux fois. */
class Allpass {
  constructor(taille) {
    this.taille = Math.max(4, Math.floor(taille));
    this.g = new Float64Array(this.taille + 1);
    this.d = new Float64Array(this.taille + 1);
    this.i = 0;
  }
}

export class Monitoring {
  constructor(taux) {
    this.echelle = taux / 44100.0;
    // 149 et 223 : les longueurs de Chris, mises à l'échelle du taux réel
    this.a = new Allpass(149 * this.echelle);
    this.d = new Allpass(223 * this.echelle);
    // la cascade de SubsOnly : vingt-six passe-bas d'un pôle, par canal
    this.subs = [new Float64Array(26), new Float64Array(26)];
    this.pente = [0, 0];        // dernier échantillon, pour SlewOnly
    this.basse = [0, 0];        // filtres de resserrement des graves (Cans)
  }

  /** Remet les mémoires à zéro : changer de mode ne doit pas traîner. */
  vider() {
    this.a.g.fill(0); this.a.d.fill(0);
    this.d.g.fill(0); this.d.d.fill(0);
    this.subs[0].fill(0); this.subs[1].fill(0);
    this.pente[0] = 0; this.pente[1] = 0;
    this.basse[0] = 0; this.basse[1] = 0;
  }

  traiter(gauche, droite, mode) {
    if (mode === 'normal' || !MODES.includes(mode)) return;
    const n = gauche.length;

    if (mode === 'mono' || mode === 'cote') {
      // Le mid/side de Chris : on annule l'un des deux et l'on recompose.
      for (let i = 0; i < n; i++) {
        let mid = gauche[i] + droite[i];
        let cote = gauche[i] - droite[i];
        if (mode === 'mono') cote = 0; else mid = 0;
        gauche[i] = (mid + cote) / 2;
        droite[i] = (mid - cote) / 2;
      }
      return;
    }

    if (mode === 'graves') {
      // SubsOnly : la même cellule vingt-six fois, avec un gain qui
      // s'essouffle — c'est cette répétition qui fait la pente très raide.
      const quantite = (2250 / 44100.0) / this.echelle;
      for (let c = 0; c < 2; c++) {
        const canal = c === 0 ? gauche : droite;
        const memoire = this.subs[c];
        for (let i = 0; i < n; i++) {
          let x = canal[i] * 1.42;
          let gain = ((1.42 - 1) * 0.75) + 1;
          for (let k = 0; k < memoire.length; k++) {
            memoire[k] = (memoire[k] * (1 - quantite)) + (x * quantite);
            x = memoire[k];
            // le dernier étage ne prend pas de gain, comme chez Chris
            if (k < memoire.length - 1) {
              x *= gain;
              gain = ((gain - 1) * 0.75) + 1;
            }
            if (x > 1) x = 1; else if (x < -1) x = -1;
          }
          canal[i] = x;
        }
      }
      return;
    }

    if (mode === 'cretes') {
      // PeaksOnly : un allpass, puis asin() — l'inverse de la sinusoïde de
      // Console, qui étale ce qui est petit et ramène ce qui est grand.
      const ap = this.d;
      for (let i = 0; i < n; i++) {
        let g = gauche[i];
        let d = droite[i];
        const avant = (ap.i - 1 + ap.taille + 1) % (ap.taille + 1);
        g -= ap.g[avant] * 0.5; ap.g[ap.i] = g; g *= 0.5;
        d -= ap.d[avant] * 0.5; ap.d[ap.i] = d; d *= 0.5;
        ap.i = (ap.i - 1 + ap.taille + 1) % (ap.taille + 1);
        g += ap.g[ap.i];
        d += ap.d[ap.i];
        g = Math.asin(Math.max(-1, Math.min(1, g))) * 0.63679;
        d = Math.asin(Math.max(-1, Math.min(1, d))) * 0.63679;
        gauche[i] = g;
        droite[i] = d;
      }
      return;
    }

    // CASQUE — Cans C (le réglage 14 de Chris : diaphonie à 0,30).
    const bass = (14 * 14 * 0.00001) / this.echelle;
    for (let i = 0; i < n; i++) {
      // « tout se passe DANS Console » : encodage sinus à l'entrée…
      let g = Math.sin(Math.max(-1, Math.min(1, gauche[i])));
      let d = Math.sin(Math.max(-1, Math.min(1, droite[i])));
      let secG = g;
      let secD = d;

      // resserrement des graves : le très bas redevient central, comme dans
      // une pièce — c'est ce qui empêche la diaphonie de brouiller le bas
      let mid = g + d;
      let cote = g - d;
      this.basse[0] = (this.basse[0] * (1 - (bass * 0.618))) + (cote * bass * 0.618);
      cote -= this.basse[0];
      g = (mid + cote) / 2;
      d = (mid - cote) / 2;

      const passer = (ap) => {
        const avant = (ap.i - 1 + ap.taille + 1) % (ap.taille + 1);
        g -= ap.g[avant] * 0.5; ap.g[ap.i] = g; g *= 0.5;
        d -= ap.d[avant] * 0.5; ap.d[ap.i] = d; d *= 0.5;
        ap.i = (ap.i - 1 + ap.taille + 1) % (ap.taille + 1);
        g += ap.g[ap.i] * 0.5; d += ap.d[ap.i] * 0.5;
        const suivant = ap.i === ap.taille ? 0 : ap.i + 1;
        g += ap.g[suivant] * 0.5; d += ap.d[suivant] * 0.5;
      };

      passer(this.a);
      g *= 0.30; d *= 0.30;      // Cans C
      secG += d; secD += g;      // LA diaphonie : chaque oreille entend l'autre

      passer(this.d);
      g *= 0.25; d *= 0.25;      // la seconde floraison, plus loin, plus sombre
      secG += d; secD += g;

      g = secG; d = secD;
      mid = g + d; cote = g - d;
      this.basse[1] = (this.basse[1] * (1 - bass)) + (cote * bass);
      cote -= this.basse[1];
      g = (mid + cote) / 2;
      d = (mid - cote) / 2;

      // …et décodage asin() à la sortie : on ressort de Console
      gauche[i] = Math.asin(Math.max(-1, Math.min(1, g)));
      droite[i] = Math.asin(Math.max(-1, Math.min(1, d)));
    }
  }
}

class MonitoringProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.moteur = new Monitoring(sampleRate);
    this.mode = 'normal';
    this.vivant = true;
    this.port.onmessage = (e) => {
      if (e.data?.arret) { this.vivant = false; return; }
      if (typeof e.data?.mode === 'string' && e.data.mode !== this.mode) {
        this.mode = e.data.mode;
        // Une cascade de vingt-six filtres garde une seconde de son : sans
        // ce vidage, revenir en « normal » laisserait une traîne.
        this.moteur.vider();
      }
    };
  }

  process(entrees, sorties) {
    const entree = entrees[0];
    const sortie = sorties[0];
    if (!sortie || !sortie.length) return this.vivant;
    if (!entree || !entree.length) {
      for (const canal of sortie) canal.fill(0);
      return this.vivant;
    }
    const g = sortie[0];
    const d = sortie.length > 1 ? sortie[1] : sortie[0];
    g.set(entree[0]);
    if (sortie.length > 1) d.set(entree.length > 1 ? entree[1] : entree[0]);
    if (sortie.length > 1) this.moteur.traiter(g, d, this.mode);
    for (let c = 2; c < sortie.length; c++) sortie[c].set(g);
    return this.vivant;
  }
}

registerProcessor('galerie-monitoring', MonitoringProcessor);
export { MODES };
