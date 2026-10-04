/**
 * REDIMENSIONNER UN ESPACE (editor/state/murs-regles.js) : ce qui est
 * contre un mur le suit, le reste ne bouge pas ; un mur absent n'entraîne
 * rien ; le sol garde sa marge, couvre un mur creusé, et un sol voulu plus
 * vaste reste tel quel.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { suivreMurs, tailleSol, planRedimension, planSommet, SEUIL_MUR } from '../engine/src/editor/state/murs-regles.js';

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

test('le sommet entraîne ce qui est près du haut ; une corniche ne suit que la hauteur', () => {
  const coque = { width: 20, depth: 16, height: 6 };
  const oeuvres = [
    { id: 'lampe-haute', position: [0, 5.4, -7.9] },              // contre le nord, près du haut
    { id: 'tableau', position: [-3, 1.6, -7.9] },                 // contre le nord, bas : ne bouge pas
    { id: 'stele', position: [0, 5.5, 0] },                       // au milieu de la pièce : ne bouge pas
    { id: 'corniche', position: [2, 5.6, -7.9], model: { shape: 'corniche' } }
  ];
  // le nord monte en arche de 2 m au milieu
  const arche = { ...coque, courbe: { profondeur: 0, couronne: { forme: 'arche', sens: 'haut', hauteur: 2, ondes: 1 } } };
  const r = planSommet(coque, arche, oeuvres);
  assert.deepEqual(r.map((o) => o.id), ['lampe-haute'], 'seule la lampe près du haut suit');
  assert.ok(Math.abs(r[0].position[1] - (5.4 + 2)) < 0.01, `au milieu, +2 : ${r[0].position[1]}`);
  // l'angle nord-est descend de 3 : la lampe (au milieu du mur) descend de 1,5
  const angle = { ...coque, courbe: { profondeur: 0, angles: { ne: -3 } } };
  const r2 = planSommet(coque, angle, oeuvres);
  assert.ok(Math.abs(r2[0].position[1] - (5.4 - 1.5)) < 0.02, `angle : ${r2[0]?.position[1]}`);
  // la hauteur : la corniche suit aussi
  const p = planRedimension({ shell: coque }, oeuvres, { height: 8 });
  assert.deepEqual(p.oeuvres.map((o) => [o.id, o.position[1]]), [['lampe-haute', 7.4], ['corniche', 7.6]]);
  // un mur absent n'entraîne rien
  assert.deepEqual(planSommet({ ...coque, walls: ['sud'] }, { ...arche, walls: ['sud'] }, oeuvres), []);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
