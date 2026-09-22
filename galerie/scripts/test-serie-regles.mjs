/**
 * RÉPÉTER SANS EFFORT (editor/state/serie-regles.js).
 *
 * Une série suit l'axe DE L'OBJET : tourné de 90°, sa largeur pointe
 * vers −z, et la rangée avec elle. Le pas se déduit de l'emprise, les
 * titres se numérotent, les identifiants restent à l'insertion. Tout au
 * nœud, sans moteur.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { serieEnLigne, directionAxe, pasParDefaut, SERIE_MAX, INTERSTICE }
  from '../engine/src/editor/state/serie-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const proche = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

console.log('\nrépéter sans effort');

test('la direction d\'un axe de l\'objet suit son lacet', () => {
  assert.ok(proche(directionAxe('x', 0), [1, 0, 0]));
  assert.ok(proche(directionAxe('x', 90), [0, 0, -1]));     // Ry(90°) · X = −Z
  assert.ok(proche(directionAxe('z', 90), [1, 0, 0]));      // Ry(90°) · Z = X
  assert.ok(proche(directionAxe('z', 0), [0, 0, 1]));
  assert.ok(proche(directionAxe('y', 137), [0, 1, 0]));
});

test('le pas par défaut : l\'emprise sur l\'axe, plus l\'interstice, au décimètre', () => {
  const panneau = { size: [3, 2], scale: [1, 1, 1] };
  assert.equal(pasParDefaut(panneau, 'x'), 3 + INTERSTICE);
  const cube = { model: { shape: 'box' }, scale: [1, 2, 1] };   // 1,5 m de côté, 3 m de haut
  assert.equal(pasParDefaut(cube, 'x'), 2);                     // 1,5 + 0,5
  assert.equal(pasParDefaut(cube, 'y'), 3.5);                   // 3 + 0,5
  assert.equal(pasParDefaut(cube, 'z'), 2);
  assert.ok(pasParDefaut({}, 'x') >= 0.5);
});

test('une série en ligne : n copies à pas constant le long de l\'axe X de l\'objet', () => {
  const socle = { id: 'socle', title: 'Socle', position: [1, 0.5, -3], rotation: [0, 0, 0], scale: [1, 1, 1], model: { shape: 'box' } };
  const copies = serieEnLigne(socle, { nombre: 3, pas: 2, axe: 'x' });
  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map((c) => c.position), [[3, 0.5, -3], [5, 0.5, -3], [7, 0.5, -3]]);
  assert.deepEqual(copies.map((c) => c.title), ['Socle (2)', 'Socle (3)', 'Socle (4)']);
  assert.ok(copies.every((c) => c.id === 'socle'));            // l'insertion rend l'identifiant unique
  assert.ok(copies.every((c) => c.model.shape === 'box' && c !== socle && c.model !== socle.model));
  assert.deepEqual(socle.position, [1, 0.5, -3]);              // l'original n'a pas bougé
});

test('la rangée tourne avec l\'objet, et un pas négatif part de l\'autre côté', () => {
  const panneau = { id: 'p', position: [0, 1.5, 0], rotation: [0, 90, 0], size: [2, 1] };
  const [a, b] = serieEnLigne(panneau, { nombre: 2, pas: 3, axe: 'x' });
  assert.ok(proche(a.position, [0, 1.5, -3]));
  assert.ok(proche(b.position, [0, 1.5, -6]));
  const [c] = serieEnLigne(panneau, { nombre: 1, pas: -3, axe: 'x' });
  assert.ok(proche(c.position, [0, 1.5, 3]));
  const [haut] = serieEnLigne(panneau, { nombre: 1, pas: 1.2, axe: 'y' });
  assert.ok(proche(haut.position, [0, 2.7, 0]));
});

test('sans pas, le pas par défaut ; sans titre, pas de numéro ; borné à SERIE_MAX', () => {
  const cube = { id: 'c', position: [0, 0, 0], model: { shape: 'box' }, scale: [1, 1, 1] };
  const [c] = serieEnLigne(cube, { nombre: 1 });
  assert.ok(proche(c.position, [pasParDefaut(cube, 'x'), 0, 0]));
  assert.equal(c.title, undefined);
  assert.equal(serieEnLigne(cube, { nombre: 999, pas: 1 }).length, SERIE_MAX);
  assert.deepEqual(serieEnLigne(cube, { nombre: 0 }), []);
  assert.deepEqual(serieEnLigne(null, { nombre: 3 }), []);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
