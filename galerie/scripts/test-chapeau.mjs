/**
 * LES PORTES DU CHAPEAU (modules/chapeau-regles.js) : quand l'écran de fin
 * s'ouvre, et quand il se tait.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { porteDuChapeau } from '../engine/src/modules/chapeau-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles portes du chapeau');

test('tout découvert par cette visite : la porte « découverte »', () => {
  assert.equal(porteDuChapeau({ complet: true, nouvelles: 3 }), 'decouverte');
  assert.equal(porteDuChapeau({ complet: true, nouvelles: 1, minutes: 30 }), 'decouverte', 'la découverte passe avant la durée');
});

test('un visiteur qui revient avec un catalogue plein mais rien de neuf : rien', () => {
  assert.equal(porteDuChapeau({ complet: true, nouvelles: 0 }), null);
  assert.equal(porteDuChapeau({ complet: false, nouvelles: 5 }), null);
});

test('douze minutes de visite : la porte « durée », sauf pendant la visite guidée', () => {
  assert.equal(porteDuChapeau({ minutes: 11.9 }), null);
  assert.equal(porteDuChapeau({ minutes: 12 }), 'duree');
  assert.equal(porteDuChapeau({ minutes: 20, deriveActive: true }), null);
  assert.equal(porteDuChapeau({ minutes: 5, seuil: 4 }), 'duree');
});

test('une fois montré, plus jamais ; des entrées absentes ou absurdes ne l\'ouvrent pas', () => {
  assert.equal(porteDuChapeau({ complet: true, nouvelles: 3, dejaMontre: true }), null);
  assert.equal(porteDuChapeau({ minutes: 60, dejaMontre: true }), null);
  assert.equal(porteDuChapeau(), null);
  assert.equal(porteDuChapeau({ minutes: NaN }), null);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
