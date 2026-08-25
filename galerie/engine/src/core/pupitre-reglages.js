/**
 * Le pupitre de mixage : quelle table, et combien.
 *
 * À part de `Pupitre.js`, qui charge la source du worklet (`?raw`) : ce qui
 * décide de quelque chose doit pouvoir s'éprouver au nœud.
 */

/**
 * LES CINQ TABLES DE CHRIS, et ce qui les sépare.
 *
 * Trois nombres chacune, et le plus parlant est le SEUIL DE VITESSE : ce
 * qu'une table n'arrive pas à suivre. Une SSL suit presque tout (0,85) et
 * c'est pour cela qu'on la dit propre ; une Neve suit deux fois moins vite
 * (0,33) et arrondit les attaques, ce qu'on appelle « du corps » ; une Teac
 * et une Mackie ne suivent presque rien (0,15 et 0,09) et étalent tout, ce
 * qui est exactement le son d'un enregistrement de chambre des années 90.
 *
 * Ce n'est donc pas un choix de couleur mais un choix de MOYENS. Une galerie
 * de sons faits chez soi n'a aucune raison de sonner comme un studio de
 * Londres, et peut choisir de le dire.
 *
 * `bande` est en hertz. Au-dessus de la moitié du taux d'échantillonnage le
 * filtre est SAUTÉ — c'est le `< 0,49999` de Chris, gardé tel quel : à
 * 44,1 kHz les trois tables chères ne limitent pas la bande du tout, et
 * seules la Teac et la Mackie la rétrécissent. C'est voulu, et c'est ce qui
 * les distingue le plus à ce taux-là.
 */
export const PUPITRES = {
  neve: { nom: 'Neve', dielectrique: 0.005832, vitesse: 0.33362176, bande: 28811,
    desc: 'large et lente — elle arrondit les attaques' },
  api: { nom: 'API', dielectrique: 0.004096, vitesse: 0.59969536, bande: 27216,
    desc: 'plus vive, la même largeur' },
  ssl: { nom: 'SSL', dielectrique: 0.004913, vitesse: 0.84934656, bande: 23011,
    desc: 'la plus rapide — celle qu’on dit propre' },
  teac: { nom: 'Teac', dielectrique: 0.009216, vitesse: 0.149, bande: 18544,
    desc: 'étroite et très lente — le quatre-pistes' },
  mackie: { nom: 'Mackie', dielectrique: 0.011449, vitesse: 0.092, bande: 19748,
    desc: 'la table de chambre, et elle s’entend' }
};

/** L'ordre du sélecteur : du plus cher au plus modeste. */
export const ORDRE_PUPITRES = ['neve', 'api', 'ssl', 'teac', 'mackie'];

export const PUPITRE_DEFAUTS = {
  // ÉTEINT PAR DÉFAUT, et c'est délibéré : une table est un parti pris sur
  // le son de TOUTE la galerie. L'allumer sans qu'on l'ait demandé
  // changerait ce que l'auteur a mixé, dans son dos.
  actif: false,
  table: 'neve',
  // « Drive » chez Chris : 0 rien, 0,5 la saturation Spiral au complet,
  // 1 la sinusoïde par-dessus. Au-delà de la moitié, ça s'entend comme un
  // effet et non comme une table.
  attaque: 0.35,
  sortie: 1
};

/** Réglages relus et bornés — un JSON écrit à la main n'est pas de confiance. */
export function normaliserPupitre(brut) {
  const c = { ...PUPITRE_DEFAUTS, ...(brut ?? {}) };
  const borne = (v, min, max, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : repli;
  };
  return {
    actif: c.actif === true,
    table: PUPITRES[c.table] ? c.table : PUPITRE_DEFAUTS.table,
    attaque: borne(c.attaque, 0, 1, PUPITRE_DEFAUTS.attaque),
    sortie: borne(c.sortie, 0, 1, PUPITRE_DEFAUTS.sortie)
  };
}

/** L'indice que comprend le worklet — il ne parle pas en noms. */
export function indiceDePupitre(table) {
  const i = ORDRE_PUPITRES.indexOf(table);
  return i < 0 ? ORDRE_PUPITRES.indexOf(PUPITRE_DEFAUTS.table) : i;
}

/** …et l'inverse, pour relire ce que le worklet a reçu. */
export function pupitreDIndice(i) {
  return ORDRE_PUPITRES[Math.round(Number(i) || 0)] ?? PUPITRE_DEFAUTS.table;
}
