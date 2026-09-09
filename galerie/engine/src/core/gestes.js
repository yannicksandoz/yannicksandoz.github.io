/**
 * TROIS GESTES, PUIS SILENCE — la prise en main après l'entrée.
 *
 * Une ligne grise permanente rappelait les touches en bas de l'écran : on
 * finit par ne plus la voir, et elle n'apprend rien à qui sait déjà. À la
 * place, UN mot à la fois, qui s'efface dès que le geste est fait :
 *
 *   regarder   — glisser la souris, bouton enfoncé (l'orbite)
 *   avancer    — les touches de marche ou les flèches
 *   approcher  — cliquer une œuvre, ou Espace sur ce que vise le centre
 *
 * L'ordre d'affichage est celui-ci, mais un geste fait « d'avance » compte :
 * qui marche avant d'avoir regardé n'aura plus « avancez » à faire. Les
 * gestes faits se gardent d'une visite à l'autre (Memoire, clé
 * `galerie-gestes`) : la prise en main ne se refait pas, l'aide reste dans
 * le menu. Ce module est PUR : l'état, les transitions, rien du DOM.
 */

export const GESTES = ['regarder', 'avancer', 'approcher'];

/**
 * @param {object} [options]
 * @param {string[]} [options.faits]  les gestes déjà faits (mémoire)
 * @param {(courant: string|null, fait: string) => void} [options.surChangement]
 *   appelé après chaque geste nouveau, avec le geste à montrer ensuite
 */
export function creerGestes({ faits = [], surChangement = null } = {}) {
  const restants = GESTES.filter((g) => !faits.includes(g));
  return {
    /** Le geste à montrer maintenant, ou null quand tout est fait. */
    get courant() { return restants[0] ?? null; },
    get fini() { return restants.length === 0; },
    /** Les gestes faits, dans l'ordre canonique (pour la mémoire). */
    get faits() { return GESTES.filter((g) => !restants.includes(g)); },
    /**
     * Le visiteur vient de faire ce geste. Rend true s'il comptait (connu
     * et pas encore fait) ; un geste inconnu ou déjà fait ne change rien
     * et ne prévient personne.
     */
    faire(nom) {
      const i = restants.indexOf(nom);
      if (i < 0) return false;
      restants.splice(i, 1);
      surChangement?.(this.courant, nom);
      return true;
    }
  };
}

/** Lit la liste des gestes faits dans une mémoire (JSON) ; jamais d'exception. */
export function lireGestes(memoire, cle = 'galerie-gestes') {
  try {
    const brut = memoire?.getItem?.(cle);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste.filter((g) => GESTES.includes(g)) : [];
  } catch { return []; }
}

/** Écrit la liste des gestes faits ; un stockage absent ou plein ne casse rien. */
export function ecrireGestes(memoire, faits, cle = 'galerie-gestes') {
  try { memoire?.setItem?.(cle, JSON.stringify(faits)); return true; } catch { return false; }
}
