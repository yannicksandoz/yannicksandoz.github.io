/**
 * Les modes de l'écoute de contrôle, et ce que chacun apprend.
 *
 * À part du reste parce que `Ecoute.js` charge la source du worklet (`?raw`,
 * une affaire de bundler) : cette liste doit pouvoir s'éprouver au nœud, et
 * elle doit rester d'accord avec `monitoring-worklet.js` — un test le
 * vérifie, sans quoi un bouton pourrait pointer un mode qui n'existe pas.
 */
export const MODES_ECOUTE = [
  { cle: 'normal', nom: 'Normal', aide: 'Ce qui sort, sans loupe.' },
  { cle: 'mono', nom: 'Mono',
    aide: 'Les deux canaux additionnés. Ce qui disparaît ici s’annulera sur '
      + 'un haut-parleur de téléphone : c’est le test de phase.' },
  { cle: 'cote', nom: 'Côté',
    aide: 'Leur différence seule — exactement ce que la spatialisation a '
      + 'fabriqué. Sur une source mal panoramiquée, il ne reste rien.' },
  { cle: 'graves', nom: 'Graves',
    aide: 'Vingt-six passe-bas en cascade : il ne reste que le très bas. '
      + 'Les ronflements et les nappes qui s’accumulent s’entendent enfin.' },
  { cle: 'cretes', nom: 'Crêtes',
    aide: 'Les transitoires sans le corps : clics, coupures de boucle, '
      + 'attaques qui claquent.' },
  { cle: 'casque', nom: 'Casque ouvert',
    aide: 'La diaphonie de Chris (Cans C) : chaque oreille entend un peu de '
      + 'l’autre, avec le retard d’une vraie tête. Ce que des haut-parleurs '
      + 'feraient — le binaural y tient-il encore ?' }
];

const CLES = new Set(MODES_ECOUTE.map((m) => m.cle));

export function modeEcouteValide(mode) {
  return CLES.has(mode) ? mode : 'normal';
}

