/**
 * LES BORNES D'UNE PISTE — « début » et « fin » dans le fichier son.
 *
 * Deux moitiés de contrat : ce qui est écrit correctement doit être suivi
 * À LA SECONDE, et ce qui est écrit n'importe comment ne doit JAMAIS rendre
 * une œuvre muette. La seconde moitié est celle qu'on casse sans le voir.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { secondes, bornesLecture, lancerBoucle }
  from '../engine/src/core/son-bornes.js';

let ok = 0, ko = 0;
const groupe = (t) => console.log(`\n${t}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${String(e.message).split('\n')[0]}`); }
};

groupe('lire un instant comme sur un lecteur');

test('les écritures acceptées donnent les bonnes secondes', () => {
  assert.equal(secondes(12), 12);
  assert.equal(secondes('12'), 12);
  assert.equal(secondes('12.5'), 12.5);
  assert.equal(secondes('0:12'), 12);
  assert.equal(secondes('1:23'), 83);
  assert.equal(secondes('1:23.5'), 83.5);
  assert.equal(secondes('1:02:03'), 3723);
  assert.equal(secondes(0), 0);
});

test('tout le reste est refusé, sans exception ni exception levée', () => {
  for (const v of ['abc', '', '  ', ':30', '1:99', '1:2:3:4', null, undefined,
    {}, [], NaN, Infinity, -3, '-3', '3:-1']) {
    assert.equal(secondes(v), null, `« ${JSON.stringify(v)} » aurait dû être refusé`);
  }
});

groupe('les bornes confrontées au fichier réel');

test('des bornes justes se retrouvent telles quelles', () => {
  const b = bornesLecture({ debut: '0:04.5', fin: '5:42.5' }, 344.34);
  assert.equal(b.debut, 4.5);
  assert.equal(b.fin, 342.5);
  assert.equal(b.borne, true);
});

test('sans bornes, la piste court sur tout le fichier', () => {
  const b = bornesLecture({}, 344);
  assert.deepEqual(b, { debut: 0, fin: 344, borne: false });
});

test('une fin au-delà du fichier se rabat sur sa durée', () => {
  const b = bornesLecture({ debut: 2, fin: 900 }, 344);
  assert.equal(b.fin, 344);
  assert.equal(b.debut, 2);
});

test('une borne absurde est ignorée — jamais de silence par faute de frappe', () => {
  // début après la fin du fichier : on relit tout depuis le début
  assert.deepEqual(bornesLecture({ debut: '400' }, 344),
    { debut: 0, fin: 344, borne: false });
  // fin avant le début : la fin est ignorée, le début tient
  const envers = bornesLecture({ debut: '10', fin: '5' }, 344);
  assert.equal(envers.debut, 10);
  assert.equal(envers.fin, 344);
  // bornes illisibles : comme si elles n'existaient pas
  assert.deepEqual(bornesLecture({ debut: 'plus tard', fin: 'à la fin' }, 344),
    { debut: 0, fin: 344, borne: false });
  // une tranche vide (début == fin) ne doit pas produire une boucle muette
  const nulle = bornesLecture({ debut: 10, fin: 10 }, 344);
  assert.equal(nulle.fin, 344);
});

test('un buffer sans durée ne fait pas exploser le calcul', () => {
  assert.deepEqual(bornesLecture({ debut: 3 }, 0), { debut: 0, fin: 0, borne: false });
  assert.deepEqual(bornesLecture({ debut: 3 }, undefined), { debut: 0, fin: 0, borne: false });
});

groupe('le lancement d\'une source');

// une source de Web Audio en trompe-l'œil : on ne veut que ses réglages
const fausseSource = (duree) => ({
  buffer: { duration: duree }, loop: false, loopStart: 0, loopEnd: 0,
  demarrage: null,
  start(quand, offset) { this.demarrage = [quand, offset]; }
});

test('la boucle se restreint aux bornes, et démarre au début demandé', () => {
  const src = fausseSource(344.34);
  lancerBoucle(src, { debut: '0:04.5', fin: '5:42.5' }, 7);
  assert.equal(src.loop, true);
  assert.equal(src.loopStart, 4.5);
  assert.equal(src.loopEnd, 342.5);
  assert.deepEqual(src.demarrage, [7, 4.5]);
});

test('sans bornes, la boucle reste celle d\'avant (tout le buffer)', () => {
  const src = fausseSource(6);
  lancerBoucle(src, { gain: 1 }, 3);
  assert.equal(src.loop, true);
  assert.equal(src.loopStart, 0, 'loopStart intact');
  assert.equal(src.loopEnd, 0, 'loopEnd intact — three/WebAudio bouclent le tout');
  assert.deepEqual(src.demarrage, [3, 0]);
});

test('une piste sans configuration du tout se lance quand même', () => {
  const src = fausseSource(6);
  lancerBoucle(src, undefined, 0);
  assert.deepEqual(src.demarrage, [0, 0]);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
