/**
 * LES JETONS D'UNE IMAGE (utils.prendreJeton, Artwork.update) — une œuvre voisine
 * chargée par image, pas toutes à la fois.
 *
 * À l'entrée dans une salle, les œuvres des pièces d'à côté passaient
 * sous la distance de chargement ensemble et leurs primitives se
 * bâtissaient dans la même image (56 ms mesurés au belvédère). App pose
 * un jeton de chargement et un de libération par image ; chaque œuvre en
 * prend un ou attend la suivante. La suite au nœud vérifie le jeton.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { prendreJeton } from '../engine/src/core/utils.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles jetons d\'une image');

test('un jeton par image : le premier passe, le second attend', () => {
  const ctx = { chargements: 1 };
  assert.equal(prendreJeton(ctx, 'chargements'), true);
  assert.equal(prendreJeton(ctx, 'chargements'), false);
  assert.equal(ctx.chargements, 0);
});

test('deux jetons : deux passent', () => {
  const ctx = { liberations: 2 };
  assert.equal(prendreJeton(ctx, 'liberations'), true);
  assert.equal(prendreJeton(ctx, 'liberations'), true);
  assert.equal(prendreJeton(ctx, 'liberations'), false);
});

test('sans compteur (contexte d\'avant, ou test), tout est permis', () => {
  assert.equal(prendreJeton({}, 'chargements'), true);
  assert.equal(prendreJeton(null, 'chargements'), true);
  assert.equal(prendreJeton(undefined, 'chargements'), true);
});

test('un compteur à zéro ou absurde ne donne rien', () => {
  assert.equal(prendreJeton({ chargements: 0 }, 'chargements'), false);
  assert.equal(prendreJeton({ chargements: NaN }, 'chargements'), false);
  assert.equal(prendreJeton({ chargements: -1 }, 'chargements'), false);
});

test('les jetons sont indépendants par nom', () => {
  const ctx = { chargements: 1, liberations: 1 };
  assert.equal(prendreJeton(ctx, 'chargements'), true);
  assert.equal(prendreJeton(ctx, 'liberations'), true);
  assert.equal(prendreJeton(ctx, 'chargements'), false);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
