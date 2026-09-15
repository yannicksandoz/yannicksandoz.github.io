/**
 * LE HUD QUI S'EFFACE (ui/hud-tactile.js) : la minuterie, pure.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { MinuterieHud, DELAI, EFFACES } from '../engine/src/ui/hud-tactile.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle HUD qui s\'efface');

test('visible au départ, effacé après quatre secondes sans toucher', () => {
  const m = new MinuterieHud();
  assert.equal(DELAI, 4);
  assert.equal(m.visible(0), true);
  assert.equal(m.visible(3.9), true);
  assert.equal(m.visible(4), false);
  assert.equal(m.visible(60), false);
});

test('tant qu\'il est visible, chaque toucher le garde', () => {
  const m = new MinuterieHud();
  m.toucher(3);
  assert.equal(m.visible(6.9), true);
  m.toucher(6);
  assert.equal(m.visible(9.9), true);
  assert.equal(m.visible(10), false);
});

test('une fois effacé, un toucher ordinaire ne le ramène pas', () => {
  const m = new MinuterieHud();
  m.toucher(10);   // effacé depuis 4 s : un doigt qui tourne la caméra
  assert.equal(m.visible(10), false);
  assert.equal(m.tap(10, 700, 800), false);   // un tap en bas non plus
  assert.equal(m.visible(10.1), false);
});

test('un tap dans le tiers haut le ramène pour quatre secondes', () => {
  const m = new MinuterieHud();
  assert.equal(m.tap(10, 100, 800), true);
  assert.equal(m.visible(13.9), true);
  assert.equal(m.visible(14), false);
  // la frontière : le tiers exact compte encore comme le haut
  assert.equal(m.tap(20, 800 / 3, 800), true);
  assert.equal(m.tap(30, 800 / 3 + 1, 800), false);
});

test('un tap pendant qu\'il est visible ne fait que le garder', () => {
  const m = new MinuterieHud();
  assert.equal(m.tap(1, 50, 800), false);
  assert.equal(m.visible(4.9), true);
});

test('un panneau ouvert le tient visible ; fermé, quatre secondes de plus', () => {
  const m = new MinuterieHud();
  m.tenir(1, true);
  assert.equal(m.visible(100), true);
  m.tenir(100, false);
  assert.equal(m.visible(103.9), true);
  assert.equal(m.visible(104), false);
});

test('le délai se règle, et ☰ n\'est pas de ce qui s\'efface', () => {
  const m = new MinuterieHud({ delai: 2 });
  assert.equal(m.visible(1.9), true);
  assert.equal(m.visible(2), false);
  assert.ok(EFFACES.includes('#toolbox') && EFFACES.includes('#minimap'));
  assert.ok(!EFFACES.includes('#room-menu-btn') && !EFFACES.includes('#hint'));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
