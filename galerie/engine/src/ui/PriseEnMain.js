/**
 * LA PRISE EN MAIN — trois gestes, puis silence (voir core/gestes.js).
 *
 * Ce module branche l'état pur sur le monde : la mémoire de l'appareil
 * (`localStorage`, clé `galerie-gestes`), la ligne d'aide en bas de
 * l'écran (`UI.peindreGeste`), et il expose `app.gestes` pour que les
 * contrôles disent ce que le visiteur vient de faire (`faire('regarder')`,
 * `faire('avancer')`, `faire('approcher')`).
 *
 * Au doigt aussi : les mêmes trois gestes, dits avec les mots du doigt (un
 * doigt pour regarder, le manche ou deux doigts pour avancer, toucher une
 * œuvre) — l'encart de six secondes du premier lancement n'existe plus.
 */
import { creerGestes, lireGestes, ecrireGestes } from '../core/gestes.js';

export function monterPriseEnMain(app) {
  let memoire = null;
  try { memoire = window.localStorage; } catch { memoire = null; }
  const gestes = creerGestes({
    faits: lireGestes(memoire),
    surChangement: (courant) => {
      ecrireGestes(memoire, gestes.faits);
      app.ui?.peindreGeste?.(courant, Boolean(app.derive?.active));
    }
  });
  app.gestes = gestes;
  app.ui?.peindreGeste?.(gestes.courant, Boolean(app.derive?.active));
  return gestes;
}
