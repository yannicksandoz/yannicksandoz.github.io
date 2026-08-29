/**
 * Moteur audio partagé : un seul AudioContext pour toute la galerie,
 * créé au premier geste utilisateur (bouton « Entrer »), un bus maître,
 * un cache de buffers décodés, et la synchronisation du listener 3D
 * avec la caméra.
 *
 * Robustesse iOS Safari : l'AudioContext peut se retrouver suspendu à tout
 * moment (interruption, retour d'onglet). Un listener global re-déclenche
 * resume() + un buffer silencieux au premier tap suivant — le buffer muet
 * force la réouverture du canal audio quand resume() seul ne suffit pas.
 */
import { Limiteur } from './Limiteur.js';
import { Hygiene } from './Hygiene.js';
import { Pupitre } from './Pupitre.js';
import { Couleurs } from './Couleurs.js';
import { Bande } from './Bande.js';
import { Console, normaliserConsole } from './Console.js';
import { Ecoute } from './Ecoute.js';
import { Reverb } from './Reverb.js';
import { Lointain } from './Lointain.js';
import { Premieres } from './Premieres.js';

/**
 * L'INTERRUPTEUR SILENCIEUX DE L'IPHONE — et comment une galerie sonore
 * a le droit de passer outre.
 *
 * Sur iOS, le petit interrupteur latéral ne coupe pas « les sons » en bloc :
 * il coupe la catégorie de session AMBIENT, celle que Safari donne par
 * défaut à la Web Audio API. Une vidéo YouTube, elle, s'entend — parce
 * qu'elle est déclarée en catégorie PLAYBACK. C'est une déclaration
 * d'intention, pas une astuce : « ce son EST le contenu, pas un ornement ».
 *
 * Depuis iOS 16.4, cette déclaration est enfin accessible au web :
 * `navigator.audioSession.type = 'playback'`. Pour une galerie où le son
 * EST l'œuvre — un visiteur qui traverse une pièce compose son mixage —
 * c'est exactement la bonne catégorie, et la seule honnête.
 *
 * CE QUE ÇA COÛTE, ET IL FAUT LE SAVOIR : `playback` prend la parole. La
 * musique que le visiteur écoutait déjà s'interrompt (elle ne se mélange
 * pas). C'est le comportement d'un lecteur vidéo, et c'est celui qu'on
 * veut ici — deux œuvres sonores superposées n'en font aucune. Les autres
 * valeurs ne conviennent pas : `ambient` se laisse couper par
 * l'interrupteur (le défaut d'aujourd'hui), `transient` est fait pour un
 * bip, `play-and-record` demanderait le micro pour rien.
 *
 * À POSER AVANT L'AudioContext : la catégorie est lue à la création du
 * contexte. Après, elle ne mord plus sur celui qui joue déjà.
 *
 * PAS DE REPLI FOLKLORIQUE. On lit partout qu'un `<audio>` ou une `<video>`
 * muette en lecture « changerait la catégorie » sur les iOS antérieurs.
 * Ce dépôt s'est déjà fait avoir DEUX FOIS par des contournements qui ne
 * mordaient plus en silence (voir `scan-memoire.js`) : on ne rajoute pas
 * un troisième que rien ne prouve. Sur iOS 16.3 et avant, le son reste
 * coupé par l'interrupteur — et l'écran d'accueil le dit déjà, casque
 * recommandé.
 */
function jouerMalgreLeSilencieux() {
  try {
    const session = globalThis.navigator?.audioSession;
    // `type` est en lecture-écriture là où l'API existe ; ailleurs,
    // `audioSession` est simplement absent et l'on ne fait rien.
    if (session && 'type' in session) session.type = 'playback';
  } catch {
    // un navigateur qui expose l'objet sans accepter la valeur ne doit
    // surtout pas empêcher le son de démarrer
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiteur = new Limiteur();
    this.hygiene = new Hygiene();
    this.pupitre = new Pupitre();
    this.couleurs = new Couleurs();
    this.bande = new Bande();
    this.console = new Console();
    this.ecoute = new Ecoute();
    this.reverb = new Reverb();
    this.lointain = new Lointain();
    this.premieres = new Premieres();
    this.unlocked = false;
    this.sonCoupe = false;
    this._cache = new Map();
    // url → nombre d'œuvres et d'ambiances qui s'en servent (voir load)
    this._usages = new Map();
  }

  /** À appeler depuis un geste utilisateur (obligatoire sur mobile/Safari). */
  unlock() {
    if (!this.unlocked) {
      jouerMalgreLeSilencieux();
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // un contexte neuf a un écoutant neuf : la mémoire de `updateListener`
      // ne parle plus de lui
      this._listener = null;
      this.master = this.ctx.createGain();
      // le son a pu être coupé AVANT le déblocage (toolbox visible dès
      // l'entrée directe) : le choix survit à la naissance du contexte
      this.master.gain.value = this.sonCoupe ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;

      // La chaîne du maître, dans l'ordre d'une vraie table :
      //   tranches → somme → décodage console → limiteur → sortie
      // La console s'installe tout de suite (des WaveShaper, rien d'async) ;
      // le limiteur la suit dès que son worklet est prêt.
      // Le lointain prend son contexte TOUT DE SUITE, sans attendre son
      // worklet : les œuvres de la première pièce demandent leur insertion
      // dans la foulée de ce geste-ci (voir Lointain.attacher).
      this.lointain.attacher(this.ctx);
      const sortieConsole = this.console.installer(this.ctx, this.master);
      this.master.disconnect(this.ctx.destination);
      sortieConsole.connect(this.ctx.destination);
      // …puis l'écoute de contrôle, tout au bout : c'est là que se pose un
      // casque. Elle attend le limiteur, sans quoi les deux se disputeraient
      // le fil qui va à la sortie.
      this.limiteur.installer(this.ctx, sortieConsole, this.ctx.destination)
        // L'HYGIÈNE S'INSÈRE AVANT LE PLAFOND, jamais après : filtrer
        // derrière un écrêteur arrondit ce qu'il vient d'écrêter et repousse
        // des échantillons au-dessus du plafond qu'on venait de garantir.
        // Elle se pose donc entre la sortie de la console et l'entrée du
        // limiteur — c'est-à-dire devant sa marge (voir Limiteur.installer).
        .then(() => this.hygiene.installer(
          this.ctx, sortieConsole, this.limiteur.entree ?? this.ctx.destination))
        // …et LE PUPITRE devant elle : une table reçoit la somme, elle ne la
        // fabrique pas, et la saturation qu'elle ajoute doit encore passer
        // sous le coupe-haut. L'ordre est donc console → pupitre → hygiène →
        // marge → plafond, et chacun a une raison d'être là où il est.
        // …LA COULEUR d'abord, pour que le pupitre puisse se poser DEVANT
        // elle : d'abord ce que la table n'arrive pas à suivre, ensuite la
        // matière de son bus. On monte donc la couleur contre l'hygiène, puis
        // le pupitre contre la couleur.
        // LA BANDE en dernier des étages de caractère : on la monte donc
        // EN PREMIER, contre l'hygiène, et les autres se posent devant elle,
        // chacun contre le précédent. L'ordre entendu est :
        //   console → pupitre → couleur → bande → hygiène → marge → plafond
        // …et le module de Console7, chargé une fois pour toutes sans rien
        // changer à ce qui joue : la table reste la six tant qu'on ne demande
        // pas l'autre (voir Console.preparer).
        .then(() => this.console.preparer(this.ctx))
        .then(() => this.bande.installer(
          this.ctx, sortieConsole,
          this.hygiene.entree ?? this.limiteur.entree ?? this.ctx.destination))
        .then(() => this.couleurs.installer(
          this.ctx, sortieConsole,
          this.bande.entree ?? this.hygiene.entree
          ?? this.limiteur.entree ?? this.ctx.destination))
        .then(() => this.pupitre.installer(
          this.ctx, sortieConsole,
          this.couleurs.entree ?? this.hygiene.entree
          ?? this.limiteur.entree ?? this.ctx.destination))
        .then(() => this.ecoute.installer(
          this.ctx, this.limiteur._sortie ?? sortieConsole, this.ctx.destination))
        // La réverbération entre par sa propre TRANCHE, sans départ : lui en
        // donner un ferait une boucle qui monterait jusqu'à saturer.
        .then(() => this.reverb.installer(this.ctx))
        .then((retour) => { if (retour) this.console.brancher(retour); })
        // …puis les PREMIÈRES réflexions, sur le MÊME départ que la queue :
        // une pièce ne s'envoie pas deux fois (voir Premieres.js). Leur
        // retour est une tranche de plus, sans départ non plus.
        .then(() => this.premieres.installer(this.ctx, this.reverb.entree))
        .then((retour) => { if (retour) this.console.brancher(retour); })
        // …et le lointain, qui n'est ni un départ ni un étage du maître :
        // une insertion posée dans l'œuvre qui le demande (voir Lointain.js).
        .then(() => this.lointain.installer(this.ctx))
        .catch((e) => console.warn('[galerie] chaîne du maître :', e?.message ?? e));

      // Filet de sécurité iOS : à chaque tap, si le contexte n'est pas
      // « running », on le relance depuis le geste.
      const kick = () => {
        if (this.ctx && this.ctx.state !== 'running') {
          this.ctx.resume().catch(() => {});
          this._playSilentBlip();
        }
      };
      window.addEventListener('touchend', kick, { passive: true });
      window.addEventListener('pointerdown', kick, { passive: true });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._playSilentBlip();
  }

  /**
   * Coupe (ou rend) le son, au bus maître : la visite continue en silence,
   * tout joue encore — revenir au son reprend exactement où l'on en est.
   * Une petite rampe (80 ms) évite le clic de la coupure sèche. Choisi
   * AVANT le premier geste, l'état attend la naissance du contexte (unlock).
   */
  couperLeSon(coupe) {
    this.sonCoupe = Boolean(coupe);
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const maintenant = this.ctx.currentTime;
    g.cancelScheduledValues(maintenant);
    g.setTargetAtTime(this.sonCoupe ? 0 : 1, maintenant, 0.08);
  }

  /** Buffer d'un échantillon muet : réveille la sortie audio d'iOS. */
  _playSilentBlip() {
    if (!this.ctx) return;
    try {
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch { /* sans gravité */ }
  }

  /**
   * Pousse les réglages du limiteur, et SEULEMENT s'ils ont changé.
   *
   * Appelé à chaque frame : c'est le seul endroit qui voit à la fois le
   * moteur audio et `reglages.json`, et c'est ce qui permet à un curseur de
   * l'éditeur de s'entendre pendant qu'on le traîne. Comparer le texte coûte
   * moins que d'écrire cinq AudioParams soixante fois par seconde — et
   * surtout, cela ne réancre pas d'automation pour rien.
   */
  appliquerLimiteur(reglages) {
    if (!this.limiteur) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetLimiteur) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetLimiteur = reglages;
    if (signature === this._signatureLimiteur) return;
    this._signatureLimiteur = signature;
    this.limiteur.regler(reglages ?? undefined);
  }

  /** Idem pour la bande (voir Bande.js). */
  appliquerBande(reglages) {
    if (!this.bande) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetBande) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetBande = reglages;
    if (signature === this._signatureBande) return;
    this._signatureBande = signature;
    this.bande.regler(reglages ?? undefined);
  }

  /** Idem pour la matière du bus (voir Couleurs.js). */
  appliquerCouleurs(reglages) {
    if (!this.couleurs) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetCouleurs) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetCouleurs = reglages;
    if (signature === this._signatureCouleurs) return;
    this._signatureCouleurs = signature;
    this.couleurs.regler(reglages ?? undefined);
  }

  /** Idem pour la table sur laquelle tout est mixé (voir Pupitre.js). */
  appliquerPupitre(reglages) {
    if (!this.pupitre) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetPupitre) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetPupitre = reglages;
    if (signature === this._signaturePupitre) return;
    this._signaturePupitre = signature;
    this.pupitre.regler(reglages ?? undefined);
  }

  /** Idem pour les deux bornes du maître (voir Hygiene.js). */
  appliquerHygiene(reglages) {
    if (!this.hygiene) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetHygiene) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetHygiene = reglages;
    if (signature === this._signatureHygiene) return;
    this._signatureHygiene = signature;
    this.hygiene.regler(reglages ?? undefined);
  }

  /**
   * Ouvre une TRANCHE de console pour ce bus. À appeler au lieu de
   * `bus.connect(engine.master)` : la somme se fait encodée, et le bus
   * décode (voir Console.js).
   */
  brancherCanal(bus, { envoi = 1 } = {}) {
    if (!this.ctx) return bus;
    // …et un DÉPART vers la pièce, en plus du direct. Une œuvre peut
    // demander à rester sèche (`audio.envoi: 0`) dans une salle qui résonne.
    this.reverb.brancherDepart(bus, envoi);
    if (!this.console.somme) { bus.connect(this.master); return bus; }
    return this.console.brancher(bus);
  }

  /** Ferme la tranche — sans quoi son encodeur resterait dans le graphe. */
  debrancherCanal(bus) {
    this.reverb.debrancherDepart(bus);
    this.console.debrancher(bus);
  }

  /** Réglages de la pièce entendue, poussés seulement s'ils ont changé. */
  appliquerReverb(reglages, options) {
    if (!this.reverb) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    if (signature === this._signatureReverb) return;
    this._signatureReverb = signature;
    this.reverb.regler(reglages ?? undefined, options);
    // le même bloc décrit les deux étages de la pièce : la queue et ses
    // premiers retours (voir Premieres.js)
    this.premieres.regler(reglages ?? undefined, options);
  }

  /** Muet de travail : couper / rétablir une tranche sans rien écrire. */
  couperCanal(bus) { this.console.couper(bus); }
  retablirCanal(bus) { this.console.retablir(bus); }
  canalCoupe(bus) { return this.console.estCoupe(bus); }

  /** Réglages de la console, poussés seulement s'ils ont changé. */
  appliquerConsole(reglages) {
    if (!this.console) return;
    // même OBJET que la dernière fois : rien à faire — l'éditeur remplace
    // toujours l'objet quand une valeur change (TableEcoute), jamais ne le
    // mute, donc l'identité suffit et la sérialisation ne paie qu'au vrai
    // changement
    if (reglages === this._objetConsole) return;
    let signature;
    try { signature = JSON.stringify(reglages ?? null); } catch { return; }
    this._objetConsole = reglages;
    if (signature === this._signatureConsole) return;
    this._signatureConsole = signature;
    this.console.regler(normaliserConsole(reglages));
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /**
   * Charge et décode un fichier audio, mis en cache par URL et COMPTÉ.
   *
   * Sans comptage, deux œuvres qui partagent une nappe se la volaient :
   * la première à s'éloigner vidait l'entrée, et la seconde — toujours
   * audible — retéléchargeait puis redécodait le même fichier au prochain
   * rechargement. C'est le cas de `nebuleuse-drone.wav`, commun à deux
   * œuvres, et de `marees-basse.wav`, partagé entre une œuvre et l'ambiance
   * d'une pièce.
   */
  load(url) {
    if (!this.ctx) return Promise.reject(new Error('AudioContext non débloqué'));
    this._usages.set(url, (this._usages.get(url) ?? 0) + 1);
    if (!this._cache.has(url)) {
      // mode cors explicite : un hôte distant doit autoriser le CORS pour
      // que le buffer soit lisible (voir README)
      const p = fetch(url, { mode: 'cors' })
        .then((r) => {
          if (!r.ok) throw new Error(`Audio introuvable : ${url} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((buf) => this.ctx.decodeAudioData(buf));
      // un échec ne doit rester ni en cache ni au compteur
      p.catch(() => { this._cache.delete(url); this._usages.delete(url); });
      this._cache.set(url, p);
    }
    return this._cache.get(url);
  }

  /**
   * Rend un usage. Le buffer n'est oublié que lorsque PLUS PERSONNE ne s'en
   * sert : la mémoire se libère toujours, mais jamais sous les pieds d'une
   * autre œuvre.
   */
  release(url) {
    const reste = (this._usages.get(url) ?? 1) - 1;
    if (reste > 0) { this._usages.set(url, reste); return; }
    this._usages.delete(url);
    this._cache.delete(url);
  }

  /**
   * Aligne le listener Web Audio sur la caméra (position + orientation).
   *
   * Appelé à chaque frame. Quand la caméra n'a pas bougé — visiteur à
   * l'arrêt, fiche d'œuvre ouverte, focus en pause — les neuf valeurs sont
   * identiques à celles déjà posées, et neuf `setTargetAtTime` de plus ne
   * changeraient rien : l'approche exponentielle vers une cible identique
   * est sans mémoire, ré-ancrer l'événement redonne exactement la même
   * courbe. On s'en dispense donc, et le fil audio cesse d'entretenir une
   * automation permanente pour une écoute qui ne bouge pas.
   */
  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    // Colonne -Z = direction de visée, colonne Y = up
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    const d = this._listener;
    if (d && d[0] === px && d[1] === py && d[2] === pz
      && d[3] === fx && d[4] === fy && d[5] === fz
      && d[6] === ux && d[7] === uy && d[8] === uz) return;
    this._listener = [px, py, pz, fx, fy, fz, ux, uy, uz];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.03);
      l.positionY.setTargetAtTime(py, t, 0.03);
      l.positionZ.setTargetAtTime(pz, t, 0.03);
      l.forwardX.setTargetAtTime(fx, t, 0.03);
      l.forwardY.setTargetAtTime(fy, t, 0.03);
      l.forwardZ.setTargetAtTime(fz, t, 0.03);
      l.upX.setTargetAtTime(ux, t, 0.03);
      l.upY.setTargetAtTime(uy, t, 0.03);
      l.upZ.setTargetAtTime(uz, t, 0.03);
    } else {
      // Fallback ancienne API (Safari)
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }
}
