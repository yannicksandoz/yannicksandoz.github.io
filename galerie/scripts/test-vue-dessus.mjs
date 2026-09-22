/**
 * LA VUE DE DESSUS (editor/state/vue-regles.js).
 *
 * La caméra monte à l'aplomb du centre de la pièce, à l'altitude qui fait
 * tenir toute la pièce dans l'image — la profondeur contre la hauteur de
 * l'écran, la largeur contre sa largeur — jamais sous le plafond, jamais
 * trop bas pour une pièce minuscule. Tout au nœud, sans moteur.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { cadrerDessus, altitudePourVoir, hauteurSalle, CHAMP_DESSUS, MARGE_DESSUS,
  GARDE_PLAFOND, ALTITUDE_MIN } from '../engine/src/editor/state/vue-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const tan = Math.tan((CHAMP_DESSUS / 2) * Math.PI / 180);

console.log('\nla vue de dessus');

test('la hauteur d\'une pièce : sa coque, sinon cinq mètres', () => {
  assert.equal(hauteurSalle({ shell: { height: 7 } }), 7);
  assert.equal(hauteurSalle({ shell: { width: 20 } }), 5);
  assert.equal(hauteurSalle({}), 5);
  assert.equal(hauteurSalle(null), 5);
});

test('l\'altitude fait tenir la profondeur dans la hauteur de l\'écran, et la largeur dans sa largeur', () => {
  // pièce profonde sur un écran large : c'est la profondeur qui commande
  const aspect = 16 / 9;
  const h1 = altitudePourVoir(10, 20, { aspect });
  assert.ok(Math.abs(h1 - (10 * (1 + MARGE_DESSUS)) / tan) < 1e-9);
  // pièce très large : c'est la largeur, divisée par l'ouverture, qui commande
  const h2 = altitudePourVoir(60, 10, { aspect });
  assert.ok(Math.abs(h2 - (30 * (1 + MARGE_DESSUS)) / (aspect * tan)) < 1e-9);
  // un écran en portrait renverse la règle
  const h3 = altitudePourVoir(20, 10, { aspect: 9 / 16 });
  assert.ok(h3 > altitudePourVoir(20, 10, { aspect: 16 / 9 }));
  // une ouverture absurde retombe sur 16/9
  assert.equal(altitudePourVoir(10, 20, { aspect: 0 }), altitudePourVoir(10, 20, { aspect: 16 / 9 }));
});

test('le cadrage : à l\'aplomb du centre, au-dessus du plafond, jamais trop bas', () => {
  const salle = { shell: { width: 26, depth: 20, height: 5 } };
  const plan = cadrerDessus(salle, { aspect: 16 / 9 });
  assert.deepEqual(plan.cible, [0, 0, 0]);
  assert.equal(plan.position[0], 0);
  assert.equal(plan.position[2], 0);
  assert.equal(plan.position[1], plan.altitude);
  const voulu = altitudePourVoir(26, 20, { aspect: 16 / 9 });
  assert.ok(Math.abs(plan.altitude - Math.round(voulu * 100) / 100) < 1e-9);
  assert.ok(plan.altitude >= 5 + GARDE_PLAFOND);
  // une salle haute et étroite : le plafond commande
  const tour = cadrerDessus({ shell: { width: 4, depth: 4, height: 40 } });
  assert.equal(tour.altitude, 40 + GARDE_PLAFOND);
  // une pièce minuscule : l'altitude plancher
  const boite = cadrerDessus({ shell: { width: 2, depth: 2, height: 2 } });
  assert.equal(boite.altitude, ALTITUDE_MIN);
});

test('un sol nu se cadre sur sa taille, une grande pièce plus haut qu\'une petite', () => {
  const jardin = cadrerDessus({ floor: { size: 60 } });
  const salon = cadrerDessus({ shell: { width: 12, depth: 12 } });
  assert.ok(jardin.altitude > salon.altitude);
  assert.equal(cadrerDessus(null), null);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
