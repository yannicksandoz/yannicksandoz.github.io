/**
 * LE CHRONO DU DÉMARRAGE (core/chrono.js) — les marques, le bilan, le texte.
 * Une horloge de carton, pour que les écarts soient exacts.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { creerChrono } from '../engine/src/core/chrono.js';

let ok = 0;
let ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

const horloge = (instants) => { let i = 0; return () => instants[Math.min(i++, instants.length - 1)]; };

console.log('\nle chrono du démarrage');

test('les marques gardent leur ordre, et l\'écart est celui depuis la précédente', () => {
  const c = creerChrono(horloge([100, 350.4, 1200]));
  c.marquer('code'); c.marquer('galerie-lue'); c.marquer('porte');
  assert.deepEqual(c.bilan(), [
    { nom: 'code', t: 100, depuis: 100 },
    { nom: 'galerie-lue', t: 350, depuis: 250 },
    { nom: 'porte', t: 1200, depuis: 850 }
  ]);
});

test('une marque déjà posée ne bouge pas (la première image n\'arrive qu\'une fois)', () => {
  const c = creerChrono(horloge([10, 20]));
  assert.equal(c.marquer('premiere-image'), true);
  assert.equal(c.marquer('premiere-image'), false);
  assert.equal(c.instant('premiere-image'), 10);
  assert.equal(c.bilan().length, 1);
});

test('l\'instant d\'une marque absente est null, le bilan d\'un chrono vide est vide', () => {
  const c = creerChrono(horloge([0]));
  assert.equal(c.instant('rien'), null);
  assert.deepEqual(c.bilan(), []);
  assert.equal(c.texte(), '');
});

test('le texte donne une ligne par marque, avec l\'écart entre parenthèses', () => {
  const c = creerChrono(horloge([1000, 1500]));
  c.marquer('code'); c.marquer('porte');
  const lignes = c.texte().split('\n');
  assert.equal(lignes.length, 2);
  assert.match(lignes[0], /^code\s+1000 ms  \(\+1000\)$/);
  assert.match(lignes[1], /^porte\s+1500 ms  \(\+500\)$/);
});

test('sans horloge injectée, le chrono marche quand même (performance.now au nœud)', () => {
  const c = creerChrono();
  c.marquer('a');
  assert.ok(c.instant('a') >= 0);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
