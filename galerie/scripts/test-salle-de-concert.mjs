/**
 * L'ASSAINISSEMENT des salles de concert déjà écrites (core/salle-de-concert.js) :
 * une pièce née du plan de scène avant la beta.9 reçoit un parterre mat et
 * ses décors générés perdent la lampe d'accent par défaut — sans toucher aux
 * projecteurs (selfLit), à une intensité écrite par l'auteur, ni aux pièces
 * qui ne viennent pas du plan. Idempotent.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { assainirSallesDeConcert } from '../engine/src/core/salle-de-concert.js';

let ok = 0; let ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
}

const piece = () => ({
  id: 'marees', floor: { color: '#4f5959', texture: 'bois' },
  planDeScene: { version: 1, generes: ['m-batterie', 'm-scene', 'm-praticable', 'm-projecteur', 'm-ampli', 'm-corniche-nord'] },
  works: ['m-batterie', 'm-scene', 'm-praticable', 'm-projecteur', 'm-ampli', 'm-corniche-nord']
});
const oeuvres = () => [
  { id: 'm-batterie', title: 'Batterie', lightIntensity: 3.6, stems: [] },              // un musicien : sa lampe est voulue
  { id: 'm-scene', title: 'Scène', role: 'decor' },                                     // sans consigne : l'accent par défaut
  { id: 'm-praticable', title: 'Praticable', role: 'decor' },
  { id: 'm-projecteur', title: 'Projecteur', role: 'decor', selfLit: true, lightIntensity: 2.6 },
  { id: 'm-ampli', title: 'Ampli', role: 'decor', lightIntensity: 1.2 },                // réglé par l'auteur : respecté
  { id: 'm-corniche-nord', title: 'Corniche nord', role: 'decor', model: { shape: 'corniche' } }
];

console.log('\nles salles de concert déjà écrites');
test('parterre mat, décors du plan sans lampe ; projecteur, réglage d\'auteur et musicien intacts', () => {
  const rooms = [piece()]; const works = oeuvres();
  const b = assainirSallesDeConcert(rooms, works);
  assert.deepEqual(b, { salles: 1, lampes: 2, sols: 1 });
  assert.equal(rooms[0].floor.mat, true);
  const par = Object.fromEntries(works.map((w) => [w.id, w.lightIntensity]));
  assert.equal(par['m-scene'], 0);
  assert.equal(par['m-praticable'], 0);
  assert.equal(par['m-corniche-nord'], undefined, 'une corniche : forme lumineuse, le moteur ne lui donne déjà aucun accent');
  assert.equal(par['m-projecteur'], 2.6);
  assert.equal(par['m-ampli'], 1.2);
  assert.equal(par['m-batterie'], 3.6);
});

test('idempotent : une seconde passe ne compte rien', () => {
  const rooms = [piece()]; const works = oeuvres();
  assainirSallesDeConcert(rooms, works);
  assert.deepEqual(assainirSallesDeConcert(rooms, works), { salles: 0, lampes: 0, sols: 0 });
});

test('une pièce sans plan de scène, un sol déjà réglé, un décor hors du plan : rien', () => {
  const rooms = [{ id: 'archives', floor: { color: '#333' }, works: ['x'] }, { ...piece(), floor: { mat: false } }];
  const works = [{ id: 'x', role: 'decor' }, ...oeuvres()];
  const b = assainirSallesDeConcert(rooms, works);
  assert.equal(rooms[0].floor.mat, undefined);
  assert.equal(works[0].lightIntensity, undefined, 'un décor étranger au plan garde son accent');
  assert.equal(rooms[1].floor.mat, false, 'un mat écrit à faux reste faux');
  assert.deepEqual(b, { salles: 1, lampes: 2, sols: 0 });
  assert.deepEqual(assainirSallesDeConcert(null, null), { salles: 0, lampes: 0, sols: 0 });
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
