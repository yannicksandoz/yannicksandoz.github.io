/**
 * LE CHRONO DU DÉMARRAGE — où passent les secondes avant la porte.
 *
 * Pour raccourcir la première minute, il faut d'abord savoir de quoi elle
 * est faite : lire le code, lire la galerie, construire les salles, ouvrir
 * la porte, peindre la première image, finir la salle d'arrivée. Chaque
 * étape pose une MARQUE (`marquer`) ; `bilan()` rend la liste ordonnée avec
 * l'instant de chaque marque et l'écart depuis la précédente. Le tout est
 * pur : l'horloge s'injecte, ce qui permet de le tester au nœud et de
 * l'aligner sur `performance.now()` au navigateur (l'origine est l'ouverture
 * de la page — le temps de réseau du HTML et du code y est compris).
 *
 * Lecture au navigateur : `__galerie.chrono.bilan()`, ou `?chrono` dans
 * l'URL pour l'avoir en console une fois la salle d'arrivée complète.
 */

/** Un chrono neuf. `maintenant` rend des millisecondes depuis l'origine. */
export function creerChrono(maintenant = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
  const marques = [];
  return {
    /** Pose une marque nommée ; une marque déjà posée n'est pas déplacée. */
    marquer(nom) {
      if (marques.some((m) => m.nom === nom)) return false;
      marques.push({ nom, t: maintenant() });
      // la même marque dans la frise des outils de développement
      // (User Timing) : elle s'aligne sur les tâches longues et le GPU
      try { performance?.mark?.(`galerie:${nom}`); } catch { /* sans DOM */ }
      return true;
    },
    /** L'instant d'une marque, ou null. */
    instant(nom) {
      return marques.find((m) => m.nom === nom)?.t ?? null;
    },
    /** Les marques dans l'ordre, avec l'écart depuis la précédente (`depuis`). */
    bilan() {
      return marques.map((m, i) => ({
        nom: m.nom, t: Math.round(m.t),
        depuis: Math.round(i ? m.t - marques[i - 1].t : m.t)
      }));
    },
    /** Le bilan en lignes lisibles : « galerie-lue   1 234 ms  (+ 412) ». */
    texte() {
      return this.bilan().map((l) => `${l.nom.padEnd(18)} ${String(l.t).padStart(6)} ms  (+${l.depuis})`).join('\n');
    }
  };
}
