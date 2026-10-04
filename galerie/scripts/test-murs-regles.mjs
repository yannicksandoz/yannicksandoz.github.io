/**
 * REDIMENSIONNER UN ESPACE (editor/state/murs-regles.js) : ce qui est
 * contre un mur le suit, le reste ne bouge pas ; un mur absent n'entraîne
 * rien ; le sol garde sa marge, couvre un mur creusé, et un sol voulu plus
 * vaste reste tel quel.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { suivreMurs, tailleSol, planRedimension, SEUIL_MUR } from '../engine/src/editor/state/murs-regles.js';

let ok = 0; let ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
}

console.log('\nredimensionner un espace');
const avant = { width: 20, depth: 16 };
test('contre un mur : il suit ; au milieu : rien ; un angle : les deux murs', () => {
  const apres = { width: 30, depth: 16 };
  assert.deepEqual(suivreMurs([9.8, 2, 0], avant, apres), [14.8, 2, 0], 'contre le mur est : +5');
  assert.deepEqual(suivreMurs([-9.9, 2, 3], avant, apres), [-14.9, 2, 3], 'contre l’ouest : −5');
  assert.equal(suivreMurs([2, 2, 0], avant, apres), null, 'au milieu : ne bouge pas');
  assert.equal(suivreMurs([10 - SEUIL_MUR - 0.1, 0, 0], avant, apres), null, 'au-delà du seuil : ne bouge pas');
  const angle = suivreMurs([9.5, 1, 7.6], avant, { width: 24, depth: 20 });
  assert.deepEqual(angle, [11.5, 1, 9.6], 'dans l’angle sud-est : les deux');
  assert.equal(suivreMurs([9.8, 2, 0], avant, apres, { walls: ['nord'] }), null, 'mur est absent : rien');
  assert.deepEqual(suivreMurs([0, 1, -8], avant, { width: 20, depth: 10 }), [0, 1, -5], 'le nord avance de 3');
});

test('le sol garde sa marge, couvre un mur creusé, et un sol voulu vaste reste', () => {
  assert.equal(tailleSol(24, avant, { width: 30, depth: 16 }), 34, 'marge 4 gardée');
  assert.equal(tailleSol(20, avant, { width: 30, depth: 16 }), 30, 'sol juste aux murs : il reste juste');
  assert.equal(tailleSol(140, { width: 60, depth: 44 }, { width: 70, depth: 44 }), 140, 'un sol de 140 voulu exprès reste');
  assert.equal(tailleSol(80, avant, { width: 90, depth: 16 }), 94, '…sauf s’il devient trop petit');
  assert.equal(tailleSol(24, avant, avant, { courbeAvant: null, courbeApres: { profondeur: 2 } }), 28, 'un mur creusé de 2 m : le sol couvre');
  assert.equal(tailleSol(28, avant, avant, { courbeAvant: { profondeur: 2 }, courbeApres: { profondeur: 2 } }), 28, 'cran après cran, le sol ne grossit pas');
  assert.equal(tailleSol(28, avant, avant, { courbeAvant: { profondeur: 2 }, courbeApres: null }), 24, 'la courbe retirée : le sol revient');
  assert.equal(tailleSol(undefined, avant, avant), null);
});

test('le plan complet : coque, sol, œuvres et portails qui suivent', () => {
  const piece = {
    shell: { width: 20, depth: 16, height: 5, walls: ['nord', 'sud', 'est', 'ouest'] },
    floor: { size: 24, color: '#333' },
    portals: [{ to: 'b', position: [0, 0, 7.6] }, { to: 'c', position: [0, 0, 0] }]
  };
  const oeuvres = [{ id: 'tableau', position: [-3, 1.6, -7.9] }, { id: 'stele', position: [0, 0, 0] }];
  const r = planRedimension(piece, oeuvres, { depth: 22 });
  assert.deepEqual(r.shell, { width: 20, depth: 22, height: 5, walls: ['nord', 'sud', 'est', 'ouest'] });
  assert.deepEqual(r.oeuvres, [{ id: 'tableau', position: [-3, 1.6, -10.9] }]);
  assert.deepEqual(r.portails, [{ index: 0, position: [0, 0, 10.6] }]);
  assert.deepEqual(r.floor, { size: 26, color: '#333' });
  const h = planRedimension(piece, oeuvres, { height: 8 });
  assert.equal(h.oeuvres.length + h.portails.length, 0, 'la hauteur n’entraîne rien');
  assert.equal(h.floor, null, 'ni le sol');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
