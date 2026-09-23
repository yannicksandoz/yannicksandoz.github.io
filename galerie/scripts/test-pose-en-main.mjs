/**
 * LA POSE D'UN OBJET EN MAIN (editor/state/pose-regles.js).
 *
 * Tenir avant de poser : un rayon touche une surface de la pièce, et la
 * règle dit où l'objet se pose. Un panneau se colle au mur visé (ou se
 * tient debout face au visiteur), un volume se pose sur ce qu'il vise (son
 * bas affleure), un volume visé sur un mur se pose à son pied, la molette
 * tourne par pas de 15° (5° en fin). Tout au nœud, sans moteur.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { poserDepuisImpact, classerImpact, tournerParMolette, PORTEE_MUR, RETRAIT_PIED }
  from '../engine/src/editor/state/pose-regles.js';
import { EPAISSEUR_MUR, RETRAIT_MUR, hauteurVisee, empriseAuSol } from '../engine/src/core/charte-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const proche = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

console.log('\nla pose d\'un objet en main');

const salle = { id: 'salle', shell: { width: 26, depth: 20 } };
const panneau = { id: 'p', image: 'x.png', size: [3, 2], scale: [1, 1, 1] };
const cube = { id: 'c', model: { shape: 'box' }, scale: [1, 2, 1] };   // 1,5 m × 2 = 3 m de haut, centré
const DEMI = -empriseAuSol(cube).bas;                                       // 1,5 m : le centre quand le bas affleure
const Y_PANNEAU = hauteurVisee(2);                                           // 1,9 m : bas à 0,9 pour un panneau de 2 m

test('classer un impact : sol, mur, plafond, d\'après la normale', () => {
  assert.equal(classerImpact({ x: 0, y: 1, z: 0 }), 'sol');
  assert.equal(classerImpact([0, 0.8, 0.6]), 'sol');
  assert.equal(classerImpact({ x: 0, y: 0, z: -1 }), 'mur');
  assert.equal(classerImpact({ x: 0, y: -1, z: 0 }), 'plafond');
  assert.equal(classerImpact(undefined), 'sol');
});

test('un panneau qui vise un mur s\'y colle à plat, à hauteur d\'accrochage, en retrait', () => {
  const pose = poserDepuisImpact(panneau, salle, { point: [4, 1.2, -9.825], genre: 'mur' });
  assert.equal(pose.mur, 'nord');
  assert.deepEqual(pose.rotation, [0, 0, 0]);
  assert.ok(proche(pose.position, [4, Y_PANNEAU, -(10 - EPAISSEUR_MUR / 2 - RETRAIT_MUR)]));
});

test('un panneau qui vise le sol près d\'un mur s\'y colle aussi (portée de l\'aimant)', () => {
  const pose = poserDepuisImpact(panneau, salle, { point: [12.5, 0, 3], genre: 'sol' });
  assert.equal(pose.mur, 'est');
  assert.equal(pose.rotation[1], -90);
  assert.ok(13 - 12.5 <= PORTEE_MUR);
});

test('un panneau qui vise le sol loin des murs se tient debout, face au visiteur', () => {
  const pose = poserDepuisImpact(panneau, salle, { point: [0, 0, 0], genre: 'sol' }, { cap: 37, rotation: [0, 15, 0] });
  assert.equal(pose.mur, null);
  assert.ok(proche(pose.position, [0, Y_PANNEAU, 0]));
  assert.deepEqual(pose.rotation, [0, 52, 0]);
});

test('un volume qui vise le sol s\'y pose : son bas affleure la surface touchée', () => {
  const pose = poserDepuisImpact(cube, salle, { point: [2, 0, 3], genre: 'sol' }, { rotation: [0, 30, 0] });
  assert.ok(proche(pose.position, [2, DEMI, 3]));      // le centre à une demi-hauteur
  assert.deepEqual(pose.rotation, [0, 30, 0]);
  const marche = poserDepuisImpact(cube, salle, { point: [2, 0.6, 3], genre: 'sol' });
  assert.ok(proche(marche.position, [2, DEMI + 0.6, 3])); // sur une marche : plus haut d'autant
});

test('un volume qui vise un mur se pose à son pied, en avant du mur', () => {
  const pose = poserDepuisImpact(cube, salle, { point: [5, 1.5, -9.825], genre: 'mur' });
  assert.equal(pose.mur, 'nord');
  assert.ok(pose.position[2] >= -10 + RETRAIT_PIED - 1e-6);
  assert.ok(proche([pose.position[0], pose.position[1]], [5, DEMI]));
});

test('une lampe garde sa hauteur : au sol comme au pied d\'un mur', () => {
  const lampe = { id: 'l', lightType: 'point', selfLit: true, position: [0, 2.4, 0], model: { shape: 'sphere', size: 0.35 } };
  const sol = poserDepuisImpact(lampe, salle, { point: [2, 0, 3], genre: 'sol' });
  assert.ok(proche(sol.position, [2, 2.4, 3]));
  const mur = poserDepuisImpact(lampe, salle, { point: [5, 1.5, -9.825], genre: 'mur' });
  assert.equal(mur.mur, 'nord');
  assert.equal(mur.position[1], 2.4);
  assert.ok(mur.position[2] >= -10 + RETRAIT_PIED - 1e-6);
});

test('la molette tourne par pas de 15°, 5° en fin, et reste dans ]−180, 180]', () => {
  assert.equal(tournerParMolette(0, 1), 15);
  assert.equal(tournerParMolette(15, -1), 0);
  assert.equal(tournerParMolette(7, 1), 15);               // un lacet quelconque se cale sur la grille
  assert.equal(tournerParMolette(0, 1, { fin: true }), 5);
  assert.equal(tournerParMolette(175, 1), -165);         // 175 se cale à 180, puis un cran : 195 → −165
  assert.equal(tournerParMolette(-180, -1), 165);
});

test('sans impact, sans pièce ou sans objet : rien', () => {
  assert.equal(poserDepuisImpact(cube, salle, null), null);
  assert.equal(poserDepuisImpact(cube, null, { point: [0, 0, 0] }), null);
  assert.equal(poserDepuisImpact(null, salle, { point: [0, 0, 0] }), null);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
