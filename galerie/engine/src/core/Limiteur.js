import sourceWorklet from './limiteur-worklet.js?raw';
import source5 from './pression5-worklet.js?raw';
import { LIMITEUR_DEFAUTS, MOTEURS_LIMITEUR, normaliserLimiteur, reductionEnDb }
  from './limiteur-reglages.js';

export { LIMITEUR_DEFAUTS, MOTEURS_LIMITEUR, normaliserLimiteur, reductionEnDb };

/**
 * LE LIMITEUR DU MAÎTRE — ce qui fait qu'approcher n'est pas seulement
 * « plus fort ».
 *
 * Le bus maître allait droit à la sortie. Quinze sources qui s'additionnent
 * y saturent, et l'approche d'une œuvre ne s'entendait que comme un volume
 * qui monte. Avec un limiteur, le plafond tient : le son dont on s'approche
 * prend la place, et tout le reste recule d'exactement ce qu'il gagne. La
 * proximité devient une PRÉSENCE. C'est le mixage qui parle : ce qui
 * compresse le bus est ce qui commande le bus.
 *
 * L'étage lui-même est un portage des plugins Airwindows de Chris Johnson
 * (MIT) — voir `limiteur-worklet.js`, qui porte le crédit et le détail.
 *
 * DEUX CHEMINS, parce qu'un AudioWorklet peut manquer à l'appel (contexte
 * non sécurisé, navigateur ancien, `addModule` refusé) :
 *   • le worklet, qui est le vrai limiteur ;
 *   • à défaut, un DynamicsCompressorNode réglé en limiteur, suivi d'un
 *     écrêteur doux — moins fin, mais le geste reste le même, et la galerie
 *     ne se retrouve jamais sans plafond.
 *
 * Le module est chargé depuis une URL Blob, et non un fichier à part : le
 * site vit sous un chemin de base (`/galerie/`), se publie par recopie, et
 * doit fonctionner hors ligne. Une source inlinée n'a ni chemin à deviner ni
 * requête à faire échouer.
 */

export class Limiteur {
  constructor() {
    this.ctx = null;
    this.entree = null;      // le nœud où brancher le maître
    this.noeud = null;       // worklet ou compresseur
    this.mode = 'aucun';     // 'worklet' | 'repli' | 'aucun'
    this.reglages = { ...LIMITEUR_DEFAUTS };
    this._reduction = 0;     // dB, lissés pour l'affichage
    this._url = null;
  }

  /**
   * Installe le limiteur entre `source` et `destination`.
   *
   * Le branchement direct reste en place TANT QUE le worklet n'est pas prêt :
   * `addModule` est asynchrone, et couper le son en attendant ferait un trou
   * d'une demi-seconde au démarrage — juste après le bouton « Entrer », au
   * moment précis où l'on écoute.
   */
  async installer(ctx, source, destination = ctx.destination) {
    this.ctx = ctx;
    this.source = source;
    this.destination = destination;

    try {
      if (!ctx.audioWorklet) throw new Error('pas d’AudioWorklet');
      this._url = URL.createObjectURL(
        new Blob([sourceWorklet], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(this._url);
      // LES DEUX PLAFONDS SONT MONTÉS, UN SEUL EST ALIMENTÉ — comme les deux
      // moteurs de queue. Enregistrer un module au milieu d'une visite
      // demanderait d'attendre, et un plafond ne se change pas en deux fois.
      const url5 = URL.createObjectURL(
        new Blob([source5], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url5); }
      finally { URL.revokeObjectURL(url5); }
      const monter = (nom) => {
        const n = new AudioWorkletNode(ctx, nom, {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: 'explicit',
          channelInterpretation: 'speakers'
        });
        n.port.onmessage = (e) => {
          // seul le plafond ALIMENTÉ a le droit de bouger l'aiguille :
          // l'autre tourne à vide et rendrait une réduction imaginaire
          if (typeof e.data?.reduction === 'number' && n === this.noeud) {
            this._reduction = reductionEnDb(e.data.reduction);
          }
        };
        return n;
      };
      this.moteurs = {
        pressure4: monter('galerie-limiteur'),
        pressure5: monter('galerie-pression5')
      };
      this.noeud = this.moteurs[this.reglages.moteur] ?? this.moteurs.pressure5;
      this._entree = this.noeud;
      this._sortie = this.noeud;
      this.mode = 'worklet';
    } catch (err) {
      console.warn('[galerie] limiteur : worklet indisponible, repli —',
        err?.message ?? err);
      const repli = this._repli(ctx);
      this.noeud = repli.entree;
      this._entree = repli.entree;
      this._sortie = repli.sortie;
      this.mode = 'repli';
    } finally {
      if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    }

    // LA MARGE, en tête de chaîne : un simple gain, mais c'est lui qui décide
    // de tout ce qui suit. Le limiteur est un plafond, pas un correcteur de
    // niveau ; s'il reçoit une somme déjà au-dessus de un, il ne peut plus que
    // raboter, et raboter s'entend. Voir limiteur-reglages.js pour la mesure.
    this.marge = ctx.createGain();
    this.marge.gain.value = this.reglages.marge;
    this.entree = this.marge;

    // On rebranche seulement maintenant : source → marge → limiteur → sortie.
    try { source.disconnect(destination); } catch { /* pas encore branché */ }
    source.connect(this.marge);
    this.marge.connect(this._entree);
    this._sortie.connect(destination);
    this.regler(this.reglages);
    return this.mode;
  }

  /**
   * Repli : un compresseur natif en limiteur, puis une saturation sinus —
   * la même courbe que le second étage de Pressure4, faute de son premier.
   */
  _repli(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6;
    comp.ratio.value = 20;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const forme = ctx.createWaveShaper();
    const n = 1024;
    const courbe = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = ((i / (n - 1)) * 2 - 1) * 1.8;
      courbe[i] = Math.sign(x) * (Math.abs(x) > 1.57079633 ? 1 : Math.sin(Math.abs(x)));
    }
    forme.curve = courbe;
    comp.connect(forme);
    this._compresseur = comp;
    // Deux nœuds, donc deux extrémités : on branche DANS le compresseur et
    // l'on ressort PAR la mise en forme.
    return { entree: comp, sortie: forme };
  }

  /** Applique les réglages. Sans effet si le limiteur n'est pas installé. */
  regler(reglages) {
    this.reglages = normaliserLimiteur(reglages);
    const r = this.reglages;
    if (this.marge) {
      // en glissant : l'auteur traîne ce curseur en écoutant, et un saut de
      // gain sur le maître se remarque plus que le réglage lui-même
      this.marge.gain.setTargetAtTime(r.marge, this.ctx.currentTime, 0.05);
    }
    if (this.mode === 'worklet' && this.moteurs) {
      this._basculer(r.moteur);
      // les paramètres vont au plafond QUI JOUE, et l'autre est mis au repos
      // pour qu'il ne mâche pas du signal dans le vide
      const cible = this.moteurs[r.moteur] ?? this.noeud;
      const p = (nom, v) => {
        const param = cible?.parameters.get(nom);
        if (param) param.value = v;
      };
      const dormant = r.moteur === 'pressure5'
        ? this.moteurs.pressure4 : this.moteurs.pressure5;
      const q = dormant?.parameters.get('actif');
      if (q) q.value = 0;

      p('actif', r.actif ? 1 : 0);
      p('pression', r.pression);
      p('vitesse', r.vitesse);
      if (r.moteur === 'pressure5') {
        // « Mewines » chez Chris : la µ-ité. C'est la place qu'occupait la
        // douceur de la quatre, et le curseur porte le même nom.
        p('caractere', r.douceur);
        p('griffe', r.griffe);
        p('melange', r.melange);
        // SA SORTIE EST QUADRATIQUE : `(E×2)²`, donc 0,5 rend l'unité. On
        // garde `sortie` comme un multiplicateur franc, comme partout
        // ailleurs, et l'on convertit ici plutôt que de faire porter à
        // l'auteur une échelle qui n'est pas la sienne.
        p('sortie', Math.min(1, Math.sqrt(Math.max(0, r.sortie)) / 2));
      } else {
        p('douceur', r.douceur);
        p('sortie', r.sortie);
        p('compenser', r.compenser ? 1 : 0);
        p('caractere', r.caractere);
      }
    } else if (this.mode === 'repli' && this._compresseur) {
      // La pression déplace le seuil : 0 → -1 dB (le limiteur dort),
      // 1 → -30 dB (il tient tout).
      this._compresseur.threshold.value = r.actif ? -1 - (r.pression * 29) : 0;
      this._compresseur.release.value = 0.05 + ((1 - r.vitesse) * 0.6);
    }
  }

  /**
   * Change de plafond, sans qu'on entende la couture.
   *
   * Comme la bascule des moteurs de queue : on ferme le fil, on échange, on
   * rouvre. Ici c'est plus simple — un plafond n'a pas de queue — mais il a
   * une LATENCE (l'écrêteur de la cinq retarde d'un échantillon), et changer
   * en pleine onde ferait un clic. Le fondu de soixante millisecondes le
   * couvre, et le plafond ne change qu'au geste d'un auteur.
   */
  _basculer(moteur) {
    const cible = MOTEURS_LIMITEUR[moteur] ? moteur : LIMITEUR_DEFAUTS.moteur;
    const nouveau = this.moteurs?.[cible];
    if (!nouveau || nouveau === this.noeud) return;
    const ancien = this.noeud;
    const t = this.ctx.currentTime;
    this.marge?.gain.cancelScheduledValues(t);
    this.marge?.gain.setValueAtTime(this.marge.gain.value, t);
    this.marge?.gain.linearRampToValueAtTime(0, t + 0.06);
    clearTimeout(this._bascule);
    this._bascule = setTimeout(() => {
      try { this.marge.disconnect(ancien); } catch { /* déjà */ }
      try { ancien.disconnect(); } catch { /* déjà */ }
      try { ancien.port.postMessage({ vider: true }); } catch { /* déjà */ }
      this.marge.connect(nouveau);
      nouveau.connect(this.destination);
      this.noeud = nouveau;
      this._entree = nouveau;
      this._sortie = nouveau;
      const t2 = this.ctx.currentTime;
      this.marge.gain.cancelScheduledValues(t2);
      this.marge.gain.setValueAtTime(0, t2);
      this.marge.gain.linearRampToValueAtTime(this.reglages.marge, t2 + 0.3);
    }, 80);
  }

  /** Le plafond qui travaille en ce moment. */
  get moteur() {
    if (this.mode !== 'worklet' || !this.moteurs) return null;
    return this.noeud === this.moteurs.pressure5 ? 'pressure5' : 'pressure4';
  }

  /** Réduction courante, en décibels (≤ 0). */
  reduction() {
    if (this.mode === 'repli' && this._compresseur) {
      return Math.min(0, this._compresseur.reduction ?? 0);
    }
    return this._reduction;
  }

  /** Le limiteur travaille-t-il vraiment ? (pour l'affichage) */
  get actif() { return this.mode !== 'aucun' && this.reglages.actif; }
}
