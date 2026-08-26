/**
 * LA CHAÎNE DE POST-TRAITEMENT — ce qu'on a le droit de ne pas faire.
 *
 * Mesuré au belvédère sous profil mobile : la trame ne tient plus aux
 * appels de dessin (49 par image, six mille triangles) mais au PIXEL. Or
 * la chaîne relisait puis réécrivait l'image ENTIÈRE quatre fois par
 * trame : la recopie de la cible MSAA, le mélange additif du bloom, la
 * courbe de tons, puis le grain. Elle n'en fait plus qu'une.
 *
 * Deux règles portent ce gain, et toutes deux se cassent en silence — une
 * image qui reste juste sans qu'on la calcule mieux, ou pire, une image
 * qui lit un tampon périmé et qu'on ne verra qu'au franchissement d'un
 * portail. D'où ces tests.
 *
 *   1. LA COPIE DE SCÈNE. La passe de scène ne recopie sa cible dans le
 *      ping-pong du composer que si quelqu'un la lit entre elle et la
 *      sortie : l'occlusion ambiante (bureau) ou le warp de portail. Se
 *      tromper dans un sens coûte une image par trame ; dans l'autre, la
 *      sortie lit une image d'avant.
 *
 *   2. L'ÉCHELLE DU BLOOM. `bloomResScale` du profil de qualité ne servait
 *      à rien : `UnrealBloomPass.setSize`, appelé par le composer, écrasait
 *      la résolution du constructeur par « la moitié de l'écran ». La
 *      pyramide tournait à 293 × 633 sur un téléphone là où le profil
 *      demandait 147 × 317. Le réglage doit maintenant être RESPECTÉ — et
 *      le rester si three change son `setSize`.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { copieSceneNecessaire, BloomFleur } from '../engine/src/core/PasseSortie.js';

let ok = 0;
let ko = 0;
const groupe = (titre) => console.log(`\n${titre}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

/* ------------------------------------------------- 1. la copie de scène --- */

const scene = { nom: 'scene' };
const sortie = { nom: 'sortie' };
const passe = (enabled) => ({ enabled });

groupe('la copie de scène : une image par trame qu\'on ne fait plus');

test('au repos — scène puis sortie — aucune copie', () => {
  assert.equal(copieSceneNecessaire([scene, sortie], scene, sortie), false);
});

test('une passe ENDORMIE entre les deux ne change rien (le warp au repos)', () => {
  assert.equal(
    copieSceneNecessaire([scene, passe(false), sortie], scene, sortie), false);
});

test('une passe ACTIVE entre les deux exige la copie (GTAO, warp)', () => {
  assert.equal(
    copieSceneNecessaire([scene, passe(true), sortie], scene, sortie), true);
});

test('deux passes, une seule active : la copie reste due', () => {
  assert.equal(
    copieSceneNecessaire([scene, passe(false), passe(true), sortie], scene, sortie),
    true);
});

test('une passe active APRÈS la sortie ne la concerne pas', () => {
  assert.equal(
    copieSceneNecessaire([scene, sortie, passe(true)], scene, sortie), false);
});

test('chaîne inconnue (passe absente, ordre inversé) : on copie, par prudence', () => {
  assert.equal(copieSceneNecessaire([scene], scene, sortie), true);
  assert.equal(copieSceneNecessaire([sortie], scene, sortie), true);
  assert.equal(copieSceneNecessaire([sortie, scene], scene, sortie), true);
  assert.equal(copieSceneNecessaire(null, scene, sortie), true);
});

/* --------------------------------------------- 2. l'échelle de la fleur --- */

groupe('l\'échelle du bloom : le profil de qualité doit être respecté');

/**
 * On n'instancie pas un vrai BloomFleur — il lui faudrait un contexte WebGL.
 * On appelle sa méthode sur un objet qui n'a QUE ce que `setSize` touche :
 * la vraie méthode de three s'exécute donc pour de bon, et l'on relève la
 * taille qu'elle donne au premier étage de la pyramide.
 */
const dimensionner = (echelle, w, h) => {
  let base = null;
  const faux = {
    echelle,
    nMips: 1,
    renderTargetBright: { setSize: (a, b) => { base = [a, b]; } },
    renderTargetsHorizontal: [{ setSize: () => {} }],
    renderTargetsVertical: [{ setSize: () => {} }],
    separableBlurMaterials: [{ uniforms: { invSize: { value: null } } }]
  };
  BloomFleur.prototype.setSize.call(faux, w, h);
  return base;
};

test('mobile (0,25) : la pyramide tombe au QUART de l\'image, pas à la moitié', () => {
  // 390 × 844 à densité 1,5 → 585 × 1266 pixels physiques. La valeur
  // relevée au navigateur sur le build déployé : 147 × 317.
  assert.deepEqual(dimensionner(0.25, 585, 1266), [147, 317]);
});

test('bureau (0,5) : rigoureusement le comportement d\'avant', () => {
  assert.deepEqual(dimensionner(0.5, 2560, 1600), [1280, 800]);
});

test('sans échelle déclarée, on retombe sur la moitié (le défaut de three)', () => {
  assert.deepEqual(dimensionner(undefined, 800, 600), [400, 300]);
});

test('une fenêtre minuscule ne produit jamais une cible de zéro pixel', () => {
  const [w, h] = dimensionner(0.25, 3, 2);
  assert.ok(w >= 1 && h >= 1, `cible ${w}×${h}`);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
