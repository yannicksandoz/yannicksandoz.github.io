/**
 * Les couleurs de bus : laquelle, et combien.
 *
 * À part de `Couleurs.js`, qui charge la source du worklet (`?raw`) : ce qui
 * décide de quelque chose doit pouvoir s'éprouver au nœud.
 */

/**
 * LES HUIT COULEURS DE CHRIS, et le matériel qu'il a mesuré.
 *
 * Ce ne sont pas des préréglages d'égaliseur : chacune est la réponse
 * impulsionnelle relevée sur un vrai bus de console, en trente-trois prises
 * de retard. Les noms sont ceux de Chris ; le matériel entre parenthèses est
 * ce que ses commentaires de code indiquent.
 *
 * À NE PAS CONFONDRE AVEC LE PUPITRE. Channel9 modèle la VITESSE d'une table
 * — ce qu'elle n'arrive pas à suivre. Ceci modèle sa MATIÈRE. Les deux se
 * cumulent, parce qu'une vraie table a les deux, mais ils s'entendent
 * séparément et chacun s'éteint tout seul.
 */
export const COULEURS = {
  sombre: { nom: 'Dark', materiel: 'Focusrite MCI', desc: 'sombre et dense' },
  rock: { nom: 'Rock', materiel: 'SSL', desc: 'ferme et net — la table des années 80' },
  velours: { nom: 'Lush', materiel: 'Neve', desc: 'épais, chaud, un peu lent' },
  vibe: { nom: 'Vibe', materiel: 'Elation', desc: 'coloré, presque un effet' },
  holo: { nom: 'Holo', materiel: 'Precision 8', desc: 'ouvert — un préampli, pas une table' },
  poing: { nom: 'Punch', materiel: 'API', desc: 'sec et rapide, l’attaque en avant' },
  acier: { nom: 'Steel', materiel: 'Calibre', desc: 'clair et dur' },
  lampe: { nom: 'Tube', materiel: 'Manley', desc: 'rond, la saturation d’une lampe' }
};

/** L'ordre du sélecteur — celui de Chris, qui est celui de ses mesures. */
export const ORDRE_COULEURS = [
  'sombre', 'rock', 'velours', 'vibe', 'holo', 'poing', 'acier', 'lampe'
];

export const COULEURS_DEFAUTS = {
  // ÉTEINTE PAR DÉFAUT, pour la même raison que le pupitre : c'est un parti
  // pris sur le son de toute la galerie, pas une correction.
  actif: false,
  couleur: 'velours',
  // Les deux gains de Chris sont CENTRÉS sur la moitié : 0,5 est le neutre,
  // et non le minimum. En dessous on entre doucement, au-dessus on pousse —
  // dix-huit décibels de part et d'autre.
  entree: 0.5,
  sortie: 0.5,
  melange: 1
};

/** Réglages relus et bornés — un JSON écrit à la main n'est pas de confiance. */
export function normaliserCouleurs(brut) {
  const c = { ...COULEURS_DEFAUTS, ...(brut ?? {}) };
  const borne = (v, min, max, repli) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : repli;
  };
  return {
    actif: c.actif === true,
    couleur: COULEURS[c.couleur] ? c.couleur : COULEURS_DEFAUTS.couleur,
    entree: borne(c.entree, 0, 1, COULEURS_DEFAUTS.entree),
    sortie: borne(c.sortie, 0, 1, COULEURS_DEFAUTS.sortie),
    melange: borne(c.melange, 0, 1, COULEURS_DEFAUTS.melange)
  };
}

/** L'indice que comprend le worklet — il ne parle pas en noms. */
export function indiceDeCouleur(couleur) {
  const i = ORDRE_COULEURS.indexOf(couleur);
  return i < 0 ? ORDRE_COULEURS.indexOf(COULEURS_DEFAUTS.couleur) : i;
}

/** …et l'inverse, pour relire ce que le worklet a reçu. */
export function couleurDIndice(i) {
  return ORDRE_COULEURS[Math.round(Number(i) || 0)] ?? COULEURS_DEFAUTS.couleur;
}
