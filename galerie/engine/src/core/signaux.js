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

/** Les cases de FFT [lo, hi] d'une bande, pour une fréquence d'échantillonnage et une taille. */
export function casesDe(bande, fs, fftSize, nCases = fftSize / 2) {
  const [lo, hi] = BANDES[bande] ?? BANDES.niveau;
  const hzParCase = fs / fftSize;
  return [Math.max(0, Math.floor(lo / hzParCase)), Math.max(0, Math.min(nCases - 1, Math.ceil(hi / hzParCase)))];
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
 * La crête : suit les attaques tout de suite, retombe lentement — ce qui
 * fait « clignoter » une dalle sur une grosse caisse plutôt que respirer.
 */
export function crete(precedent, cible, dt, retombee = 2.5) {
  if (cible >= precedent) return cible;
  return damp(precedent, cible, retombee, dt);
}

const FFT = 512;

export class Signaux {
  constructor(app) {
    this.app = app;
    this._ecoutes = new Map();   // oeuvreId → { analyseur, bus, data, valeurs }
    this._demandes = new Set();  // ids demandés cette image
  }

  /**
   * La valeur d'un signal pour une œuvre — 0 tant que rien ne s'entend.
   * Demander, c'est s'abonner : l'analyseur naît à la prochaine image.
   */
  valeur(oeuvreId, signal = 'niveau') {
    this._demandes.add(oeuvreId);
    return this._ecoutes.get(oeuvreId)?.valeurs[signal] ?? 0;
  }

  /** Une fois par image, avant les œuvres : pose et lit les analyseurs demandés. */
  update(dt) {
    const ctx = this.app.audio?.ctx;
    if (!ctx) return;
    for (const id of this._demandes) {
      const art = this.app.artworks.find((a) => a.config.id === id);
      const bus = art?.bus ?? null;
      let e = this._ecoutes.get(id);
      if (e && e.bus !== bus) { this._lacher(e); e = null; }   // bus rendu ou neuf
      if (!e && bus) {
        const analyseur = ctx.createAnalyser();
        analyseur.fftSize = FFT;
        analyseur.smoothingTimeConstant = 0.6;
        bus.connect(analyseur);
        e = { analyseur, bus, data: new Uint8Array(analyseur.frequencyBinCount),
          valeurs: { niveau: 0, basse: 0, medium: 0, aigu: 0, crete: 0 },
          cases: Object.fromEntries(Object.keys(BANDES).map((b) => [b, casesDe(b, ctx.sampleRate, FFT)])) };
        this._ecoutes.set(id, e);
      }
      if (!e) continue;
      e.analyseur.getByteFrequencyData(e.data);
      for (const b of Object.keys(BANDES)) {
        const [lo, hi] = e.cases[b];
        e.valeurs[b] = damp(e.valeurs[b], niveauBande(e.data, lo, hi), 12, dt);
      }
      e.valeurs.crete = crete(e.valeurs.crete, niveauBande(e.data, ...e.cases.niveau), dt);
    }
    // ce qui n'est plus demandé se relâche
    for (const [id, e] of this._ecoutes) {
      if (!this._demandes.has(id)) { this._lacher(e); this._ecoutes.delete(id); }
    }
    this._demandes.clear();
  }

  _lacher(e) {
    try { e.analyseur.disconnect(); } catch { /* déjà */ }
  }

  dispose() {
    for (const e of this._ecoutes.values()) this._lacher(e);
    this._ecoutes.clear();
  }
}
