/**
 * LA SÛRETÉ DU REGARD (controls/surete-regard.js) — les pointeurs fantômes.
 *
 * OrbitControls garde un pointeur dont la toile n'a jamais vu le
 * relâchement, et le regard meurt (chaque doigt compte pour deux). La
 * comptabilité qui les repère est éprouvée ici : ce que la toile a vu
 * repartir n'est pas fantôme ; un relâchement passé ailleurs le
 * dénonce ; la fin de tout contact les dénonce tous.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { SureteRegard } from '../engine/src/controls/surete-regard.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nla sûreté du regard');

test('un pointeur vu repartir par la toile n\'est pas fantôme', () => {
  const s = new SureteRegard();
  s.enfoncer(1); s.vu(1);
  assert.equal(s.nombre, 0);
  assert.deepEqual(s.relacheAilleurs(1), []);
  assert.deepEqual(s.toutRelache(), []);
});

test('un relâchement vu par la fenêtre seule dénonce le pointeur, une fois', () => {
  const s = new SureteRegard();
  s.enfoncer(7);
  assert.equal(s.tenu(7), true);
  assert.deepEqual(s.relacheAilleurs(7), [7]);
  assert.equal(s.tenu(7), false);
  assert.deepEqual(s.relacheAilleurs(7), []);
});

test('la fin de tout contact dénonce tous les fantômes et oublie tout', () => {
  const s = new SureteRegard();
  s.enfoncer(1); s.enfoncer(2); s.enfoncer(3); s.vu(2);
  assert.deepEqual(s.toutRelache().sort(), [1, 3]);
  assert.equal(s.nombre, 0);
});

test('un même pointeur descendu deux fois ne compte qu\'une fois', () => {
  const s = new SureteRegard();
  s.enfoncer(4); s.enfoncer(4);
  assert.equal(s.nombre, 1);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
