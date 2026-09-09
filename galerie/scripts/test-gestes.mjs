/**
 * TROIS GESTES, PUIS SILENCE (core/gestes.js) — l'état pur de la prise en main.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { creerGestes, lireGestes, ecrireGestes, GESTES } from '../engine/src/core/gestes.js';

let ok = 0;
let ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

console.log('\ntrois gestes, puis silence');

test('l\'ordre canonique : regarder, avancer, approcher', () => {
  assert.deepEqual(GESTES, ['regarder', 'avancer', 'approcher']);
  const g = creerGestes();
  assert.equal(g.courant, 'regarder');
  assert.equal(g.fini, false);
});

test('chaque geste fait passe au suivant, et prévient avec le geste à montrer', () => {
  const journal = [];
  const g = creerGestes({ surChangement: (courant, fait) => journal.push([fait, courant]) });
  assert.equal(g.faire('regarder'), true);
  assert.equal(g.courant, 'avancer');
  assert.equal(g.faire('avancer'), true);
  assert.equal(g.courant, 'approcher');
  assert.equal(g.faire('approcher'), true);
  assert.equal(g.courant, null);
  assert.equal(g.fini, true);
  assert.deepEqual(journal, [['regarder', 'avancer'], ['avancer', 'approcher'], ['approcher', null]]);
});

test('un geste fait d\'avance compte : qui marche avant de regarder n\'aura plus « avancez »', () => {
  const g = creerGestes();
  assert.equal(g.faire('avancer'), true);
  assert.equal(g.courant, 'regarder');
  g.faire('regarder');
  assert.equal(g.courant, 'approcher');
  assert.deepEqual(g.faits, ['regarder', 'avancer']);
});

test('un geste inconnu ou déjà fait ne change rien et ne prévient pas', () => {
  let appels = 0;
  const g = creerGestes({ surChangement: () => appels++ });
  assert.equal(g.faire('voler'), false);
  g.faire('regarder');
  assert.equal(g.faire('regarder'), false);
  assert.equal(appels, 1);
});

test('la mémoire : les gestes faits ne se refont pas, tout fait = silence d\'emblée', () => {
  const g = creerGestes({ faits: ['regarder', 'approcher'] });
  assert.equal(g.courant, 'avancer');
  const tout = creerGestes({ faits: GESTES });
  assert.equal(tout.courant, null);
  assert.equal(tout.fini, true);
});

test('lire/écrire : JSON dans un stockage de carton, valeurs inconnues filtrées, pannes avalées', () => {
  const stock = new Map();
  const memoire = { getItem: (k) => stock.get(k) ?? null, setItem: (k, v) => stock.set(k, v) };
  assert.deepEqual(lireGestes(memoire), []);
  assert.equal(ecrireGestes(memoire, ['regarder']), true);
  assert.deepEqual(lireGestes(memoire), ['regarder']);
  stock.set('galerie-gestes', '["regarder","voler",3]');
  assert.deepEqual(lireGestes(memoire), ['regarder']);
  stock.set('galerie-gestes', '{pas du json');
  assert.deepEqual(lireGestes(memoire), []);
  const plein = { getItem: () => { throw new Error('privé'); }, setItem: () => { throw new Error('plein'); } };
  assert.deepEqual(lireGestes(plein), []);
  assert.equal(ecrireGestes(plein, ['regarder']), false);
  assert.deepEqual(lireGestes(null), []);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
