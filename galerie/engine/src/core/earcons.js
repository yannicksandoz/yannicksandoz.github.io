/**
 * LES REPÈRES SONORES — de petits sons d'interface, jamais spatialisés.
 *
 * La zone d'annonces ne parle qu'à un lecteur d'écran ; un malvoyant sans
 * lecteur, ou qui l'a coupé pour écouter les œuvres, n'entend rien quand il
 * découvre une œuvre, ramasse un jeton, franchit une porte ou la trouve
 * fermée. Cinq motifs courts, synthétisés (aucun fichier), à -14 dB, hors
 * de la chaîne du maître (ni limiteur ni couleur : ce ne sont pas des
 * œuvres). Allumés d'office en visite audio, éteints en 3D sauf au menu —
 * voir core/preferences-visite.js.
 *
 * `motif(nom)` est pur et testé ; `Earcons` touche le contexte audio.
 */
import { lireReperes, reperesActifs } from './preferences-visite.js';

/** Les motifs : des notes { f (Hz), t (départ, s), d (durée, s) }. */
const MOTIFS = {
  // deux notes qui montent : quelque chose de neuf
  decouverte: [{ f: 659, t: 0, d: 0.09 }, { f: 988, t: 0.1, d: 0.14 }],
  // un tintement clair : la poche s'alourdit
  jeton: [{ f: 1319, t: 0, d: 0.06 }, { f: 1760, t: 0.06, d: 0.16 }],
  // grave puis moins grave : on passe ailleurs
  porte: [{ f: 294, t: 0, d: 0.1 }, { f: 440, t: 0.11, d: 0.16 }],
  // deux notes basses identiques : non, pas maintenant
  fermee: [{ f: 220, t: 0, d: 0.1 }, { f: 220, t: 0.14, d: 0.1 }],
  // trois notes qui descendent : c'est fait
  fin: [{ f: 784, t: 0, d: 0.1 }, { f: 659, t: 0.12, d: 0.1 }, { f: 523, t: 0.24, d: 0.2 }]
};
export const NOMS = Object.keys(MOTIFS);
const GAIN = 0.2;   // ≈ -14 dB

export function motif(nom) {
  return MOTIFS[nom] ?? null;
}

export class Earcons {
  constructor(app) {
    this.app = app;
    this.choix = lireReperes();   // 'oui' | 'non' | null
  }

  get actifs() {
    return reperesActifs(this.choix, this.app.audioTour?.active);
  }

  /** Joue un motif, si les repères sont actifs et le contexte audio prêt. */
  jouer(nom) {
    const notes = motif(nom);
    const ctx = this.app.audio?.ctx;
    if (!notes || !ctx || ctx.state !== 'running' || !this.actifs) return false;
    const t0 = ctx.currentTime + 0.01;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      g.gain.setValueAtTime(0, t0 + n.t);
      g.gain.linearRampToValueAtTime(GAIN, t0 + n.t + 0.01);
      g.gain.setValueAtTime(GAIN, t0 + n.t + Math.max(0.02, n.d - 0.03));
      g.gain.linearRampToValueAtTime(0, t0 + n.t + n.d);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0 + n.t);
      osc.stop(t0 + n.t + n.d + 0.02);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* déjà */ } };
    }
    return true;
  }
}

export function mountEarcons(app) {
  if (!app.earcons) app.earcons = new Earcons(app);
  return app.earcons;
}
