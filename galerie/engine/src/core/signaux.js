/**
 * LES SIGNAUX — ce que le son d'une œuvre donne à lire, par bande, lissé.
 *
 * Un lien (liens.js) demande « les basses de la pulsation » ou « les crêtes
 * de la voix ». Ce service pose UN analyseur par œuvre écoutée — seulement
 * celles qu'un lien nomme, et seulement quand leur bus existe — et calcule
 * une fois par image, pour chacune, les cinq signaux (niveau, basse,
 * medium, aigu, crete), chacun entre 0 et 1, lissé. Une œuvre déchargée
 * (bus rendu) perd son analyseur et le retrouve au prochain bus.
 *
 * Un lien peut aussi demander une BANDE À CHOISIR (son passe-bande, deux
 * fréquences en Hz) : lue dans le même spectre, à la demande.
 *
 * Les calculs sont PURS et exportés : les bornes d'une bande en cases de
 * FFT, la moyenne d'une bande, le lissage à attaque/retombée. Testés au
 * nœud sur des spectres de carton.
 */
import { damp } from './utils.js';

export const BANDES = {
  niveau: [20, 16000],
  basse: [20, 250],
  medium: [250, 2000],
  aigu: [2000, 8000]
};

/** Les cases de FFT [lo, hi] entre deux fréquences (Hz), pour une fréquence d'échantillonnage et une taille. */
export function casesHz(hzLo, hzHi, fs, fftSize, nCases = fftSize / 2) {
  const hzParCase = fs / fftSize;
  const a = Math.max(0, Math.min(nCases - 1, Math.floor(hzLo / hzParCase)));
  const b = Math.max(a, Math.min(nCases - 1, Math.ceil(hzHi / hzParCase)));
  return [a, b];
}

/** Les cases de FFT [lo, hi] d'une bande nommée. */
export function casesDe(bande, fs, fftSize, nCases = fftSize / 2) {
  const [lo, hi] = BANDES[bande] ?? BANDES.niveau;
  return casesHz(lo, hi, fs, fftSize, nCases);
}

/** La moyenne 0..1 des cases [lo, hi] d'un spectre en octets (0..255). */
export function niveauBande(data, lo, hi) {
  if (!data?.length) return 0;
  const a = Math.max(0, lo); const b = Math.min(data.length - 1, hi);
  if (b < a) return 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += data[i];
  return s / ((b - a + 1) * 255);
}

/**
 * Le niveau global : la moyenne des TROIS bandes, pas des 256 cases. Une
 * grosse caisse n'occupe que deux cases sur 256 : moyennée sur le spectre
 * entier elle valait 0,02, et une crête bâtie dessus ne bougeait pas. Trois
 * bandes à poids égal, c'est une moyenne à peu près logarithmique — celle
 * de l'oreille.
 */
export function niveauGlobal(basse, medium, aigu) {
  return ((Number(basse) || 0) + (Number(medium) || 0) + (Number(aigu) || 0)) / 3;
}

/**
 * La crête : suit les attaques tout de suite, retombe lentement — ce qui
 * fait « clignoter » une dalle sur une grosse caisse plutôt que respirer.
 */
export function crete(precedent, cible, dt, retombee = 2.5) {
  if (cible >= precedent) return cible;
  return damp(precedent, cible, retombee, dt);
}

/**
 * La plage OBSERVÉE d'un signal : le plus bas et le plus haut atteints
 * récemment. Les deux bornes se resserrent lentement vers la valeur
 * courante (constante `tau`, en secondes) : ce qui a battu il y a une
 * minute ne compte plus, ce qui bat maintenant s'y lit tout de suite. Sert
 * au vu-mètre de l'éditeur pour proposer la fenêtre d'un lien.
 */
export function observer(obs, v, dt, tau = 8) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  if (!obs) return { min: x, max: x, valeur: x };
  const k = Math.min(1, Math.max(0, dt) / tau);
  return {
    min: Math.min(x, obs.min + (x - obs.min) * k),
    max: Math.max(x, obs.max + (x - obs.max) * k),
    valeur: x
  };
}

const FFT = 512;
/** Un analyseur survit ce temps-là sans demande : un lecteur à 12 Hz (l'éditeur) ne le fait pas naître et mourir à chaque image. */
const GRACE_MS = 600;

export class Signaux {
  constructor(app) {
    this.app = app;
    this._ecoutes = new Map();   // oeuvreId → { analyseur, bus, data, valeurs }
    this._demandes = new Map();  // oeuvreId → instant de la dernière demande
  }

  /**
   * La valeur d'un signal pour une œuvre — 0 tant que rien ne s'entend.
   * Demander, c'est s'abonner : l'analyseur naît à la prochaine image.
   */
  valeur(oeuvreId, signal = 'niveau', hz = null) {
    this._demandes.set(oeuvreId, this._maintenant());
    const e = this._ecoutes.get(oeuvreId);
    if (!e) return 0;
    if (signal === 'bande' && hz) return this._bande(e, hz);
    return e.valeurs[signal] ?? 0;
  }

  /**
   * Une bande À CHOISIR (le passe-bande d'un lien, en Hz) : lue dans le
   * spectre de l'image, lissée comme les autres ; une bande par paire de
   * fréquences, oubliée quand plus personne ne la lit.
   */
  _bande(e, [lo, hi]) {
    const cle = `${lo}-${hi}`;
    let b = e.bandes.get(cle);
    if (!b) {
      b = { cases: casesHz(lo, hi, e.fs, FFT), valeur: 0, lu: e.image };
      e.bandes.set(cle, b);
    }
    if (b.lu !== e.image) {
      b.valeur = damp(b.valeur, niveauBande(e.data, ...b.cases), 40, e.dt);
      b.lu = e.image;
    }
    return b.valeur;
  }

  /** Vrai si l'œuvre s'entend : un bus existe et un analyseur l'écoute. */
  ecoute(oeuvreId) {
    return this._ecoutes.has(oeuvreId);
  }

  /** Vrai si l'œuvre JOUE : ses voix sont actives (pas seulement branchées). */
  joue(oeuvreId) {
    return !!this.app.artworks?.find((a) => a.config.id === oeuvreId)?._stemsActive;
  }

  _maintenant() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /** Une fois par image, avant les œuvres : pose et lit les analyseurs demandés. */
  update(dt) {
    const ctx = this.app.audio?.ctx;
    if (!ctx) return;
    const t = this._maintenant();
    for (const [id, depuis] of this._demandes) {
      if (t - depuis > GRACE_MS) { this._demandes.delete(id); continue; }
      const art = this.app.artworks.find((a) => a.config.id === id);
      const bus = art?.bus ?? null;
      let e = this._ecoutes.get(id);
      if (e && e.bus !== bus) { this._lacher(e); e = null; }   // bus rendu ou neuf
      if (!e && bus) {
        const analyseur = ctx.createAnalyser();
        analyseur.fftSize = FFT;
        // léger : c'est l'ENVELOPPE de chaque lien (liens.js) qui lisse
        analyseur.smoothingTimeConstant = 0.4;
        bus.connect(analyseur);
        e = { analyseur, bus, data: new Uint8Array(analyseur.frequencyBinCount),
          valeurs: { niveau: 0, basse: 0, medium: 0, aigu: 0, crete: 0 },
          cases: Object.fromEntries(Object.keys(BANDES).map((b) => [b, casesDe(b, ctx.sampleRate, FFT)])),
          fs: ctx.sampleRate, bandes: new Map(), image: 0, dt: 0 };
        this._ecoutes.set(id, e);
      }
      if (!e) continue;
      e.analyseur.getByteFrequencyData(e.data);
      e.image++; e.dt = dt;
      // les bandes à choisir que plus personne ne lit s'oublient
      for (const [cle, b] of e.bandes) if (e.image - b.lu > 60) e.bandes.delete(cle);
      const inst = {};
      for (const b of ['basse', 'medium', 'aigu']) inst[b] = niveauBande(e.data, ...e.cases[b]);
      inst.niveau = niveauGlobal(inst.basse, inst.medium, inst.aigu);
      // un lissage court (≈ 25 ms) contre le grain de la FFT ; la tenue,
      // c'est l'enveloppe du lien qui la donne
      for (const b of Object.keys(BANDES)) e.valeurs[b] = damp(e.valeurs[b], inst[b], 40, dt);
      e.valeurs.crete = crete(e.valeurs.crete, inst.niveau, dt);
    }
    // ce qui n'est plus demandé se relâche
    for (const [id, e] of this._ecoutes) {
      if (!this._demandes.has(id)) { this._lacher(e); this._ecoutes.delete(id); }
    }
  }

  _lacher(e) {
    try { e.analyseur.disconnect(); } catch { /* déjà */ }
  }

  dispose() {
    for (const e of this._ecoutes.values()) this._lacher(e);
    this._ecoutes.clear();
  }
}
