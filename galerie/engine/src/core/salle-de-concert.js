/**
 * LES SALLES DE CONCERT DÉJÀ ÉCRITES — l'assainissement à la lecture.
 *
 * Une pièce née du plan de scène (`planDeScene` dans son JSON, avec la
 * liste `generes` de ce que l'assistant a fabriqué) portait, jusqu'à
 * l'application 1.0.0-beta.9, deux défauts que le plan ne refait plus :
 *
 *   • ses DÉCORS (plateau, praticables, amplis, retours) n'avaient pas de
 *     `lightIntensity`, et le moteur leur donnait l'accent par défaut — une
 *     ponctuelle violette de portée 14 m, posée 1,6 m devant l'objet, écart
 *     mis à l'échelle du plateau (9,6 m sur douze de large) : cinq lampes
 *     au ras du parterre, le voile violet mesuré ;
 *   • son PARTERRE gardait la carte de rugosité de sa matière, et la sonde
 *     de reflets (128 px) s'y lisait en blocs sous les angles rasants.
 *
 * Le contenu publié ne se réécrit pas tout seul, et la galerie en ligne
 * lit ces JSON tels quels : la règle se tient donc ICI, dans le moteur, à
 * la construction de la scène (SceneBuilder), pour les deux — visiteur et
 * auteur — sans rien demander à personne. Idempotent ; ce qu'un auteur a
 * réglé lui-même (une `lightIntensity` écrite, un `mat` posé) est respecté.
 * Pur : testé au nœud.
 */

import { LUMINAIRES } from './charte-regles.js';

/**
 * Les décors du plan qu'on ne touche pas : ceux qui portent leur propre
 * lampe (projecteur `selfLit`, intensité écrite), et les formes lumineuses
 * (corniche…), auxquelles le moteur ne donne déjà aucun accent.
 */
function estLuminaire(w) {
  return Boolean(w.selfLit) || Number.isFinite(w.lightIntensity) || LUMINAIRES.has(w.model?.shape);
}

/**
 * `rooms`, `works` : les configurations telles que lues. Modifiées en
 * place. → { salles, lampes, sols } : ce qui a été assaini, pour le journal.
 */
export function assainirSallesDeConcert(rooms, works) {
  const bilan = { salles: 0, lampes: 0, sols: 0 };
  const parId = new Map((works ?? []).map((w) => [w?.id, w]));
  for (const r of rooms ?? []) {
    const plan = r?.planDeScene;
    if (!plan || typeof plan !== 'object') continue;
    let touche = false;
    // le parterre, mat
    if (r.floor && typeof r.floor === 'object' && r.floor.mat === undefined) {
      r.floor.mat = true;
      bilan.sols++;
      touche = true;
    }
    // les décors générés, sans lampe
    for (const id of Array.isArray(plan.generes) ? plan.generes : []) {
      const w = parId.get(id);
      if (!w || w.role !== 'decor' || estLuminaire(w)) continue;
      w.lightIntensity = 0;
      bilan.lampes++;
      touche = true;
    }
    if (touche) bilan.salles++;
  }
  return bilan;
}
