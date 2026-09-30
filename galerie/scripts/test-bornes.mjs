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
import { secondes, bornesLecture, lancerBoucle, positionDansBoucle, departDe, enveloppe }
  from '../engine/src/core/son-bornes.js';
import { sautRaccord, decalage, jugerFormat } from '../engine/src/core/boucle-regles.js';

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

groupe('reprendre où l\'on en serait');

test('la position de reprise se ramène dans la boucle, et vaut le début sans position', () => {
  const b = { debut: 4.5, fin: 10.5, borne: true };
  assert.equal(positionDansBoucle(b, null), 4.5);
  assert.equal(positionDansBoucle(b, 0), 4.5);
  assert.equal(positionDansBoucle(b, 2), 6.5);
  assert.equal(positionDansBoucle(b, 6), 4.5, 'un tour entier');
  assert.equal(positionDansBoucle(b, 13.25), 5.75, 'deux tours et un quart');
  assert.equal(positionDansBoucle({ debut: 0, fin: 0, borne: false }, 3), 0, 'sans longueur : le début');
});

test('lancerBoucle reprend à la position demandée', () => {
  const src = { buffer: { duration: 20 }, start(quand, offset) { this.demarrage = [quand, offset]; } };
  lancerBoucle(src, { debut: 2, fin: 12 }, 1, 23);   // 23 s depuis le premier départ : 2 tours de 10 s + 3
  assert.deepEqual(src.demarrage, [1, 5]);
  lancerBoucle(src, {}, 1);
  assert.deepEqual(src.demarrage, [1, 0]);
});

groupe('le raccord d\'une boucle encodée (boucle-regles.js)');

const sinus = (n, periode, dephasage = 0) => Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * ((i - dephasage) / periode)));

test('une boucle de période exacte a un raccord aussi doux que le reste du signal', () => {
  const x = sinus(5000, 100);            // 50 périodes entières
  const r = sautRaccord(x, 0, 4800);      // 48 : la fin rejoint le début
  assert.ok(r.rapport < 2, `rapport ${r.rapport}`);   // un pas d'onde, pas plus
  const casse = sautRaccord(x, 0, 4825);  // un quart de période en trop : la fin ne rejoint plus le début
  assert.ok(casse.rapport > 10, `rapport ${casse.rapport}`);
});

test('le décalage d\'un signal en retard se retrouve par corrélation', () => {
  // un signal NON périodique (bruit déterministe) : une seule corrélation maximale
  let graine = 12345;
  const ref = Float32Array.from({ length: 20000 }, () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 1073741824 - 1; });
  const retard = new Float32Array(20000);
  retard.set(ref.subarray(0, 20000 - 312), 312);     // 312 échantillons d'amorce non retirés (Opus)
  assert.equal(decalage(ref, retard, { maxLag: 512, fenetre: 4096 }).lag, 312);
  assert.equal(decalage(ref, ref, { maxLag: 512, fenetre: 4096 }).lag, 0);
  const avance = new Float32Array(20000);
  avance.set(ref.subarray(40), 0);
  assert.equal(decalage(ref, avance, { maxLag: 512, fenetre: 4096 }).lag, -40);
});

test('le verdict : décalé ou qui claque, refusé ; sinon accepté', () => {
  assert.equal(jugerFormat({ lag: 0, rapportOriginal: 1.2, rapportFormat: 1.4 }).ok, true);
  assert.equal(jugerFormat({ lag: 312, rapportOriginal: 1.2, rapportFormat: 1.4 }).ok, false);
  assert.equal(jugerFormat({ lag: 1, rapportOriginal: 1.2, rapportFormat: 9 }).ok, false);
  assert.equal(jugerFormat({ lag: 1, rapportOriginal: 1.2, rapportFormat: 5 }).ok, true);   // sous 3× + 3
  assert.equal(jugerFormat({ lag: 0, rapportOriginal: 0, rapportFormat: 2.2 }).ok, true);   // un raccord presque muet : la marge absolue
  assert.match(jugerFormat({ lag: 5, rapportOriginal: 1, rapportFormat: 1 }).raisons[0], /décalé de 5/);
});

groupe('le départ partagé d\'un groupe (`sync`)');

test('sans clé, l\'œuvre garde son premier départ, ou le prend maintenant', () => {
  const h = new Map();
  assert.equal(departDe(h, undefined, 10), 10);
  assert.equal(departDe(h, '', 10, 4), 4);
  assert.equal(departDe(h, null, 10, 4), 4);
  assert.equal(h.size, 0);
});

test('avec une clé, toutes les œuvres du groupe reprennent la même horloge', () => {
  const h = new Map();
  assert.equal(departDe(h, 'scene-1', 10), 10);         // la batterie part à 10
  assert.equal(departDe(h, 'scene-1', 13.5), 10);       // la basse, réveillée plus tard, se cale sur 10
  assert.equal(departDe(h, 'scene-1', 40, null), 10);   // rechargée (premier départ oublié), toujours 10
  assert.equal(departDe(h, 'scene-2', 40), 40);         // un autre groupe, une autre horloge
  assert.equal(departDe(h, 7, 50), 50);                 // une clé numérique vaut sa chaîne
  assert.equal(departDe(h, '7', 60), 50);
});

test('l\'enveloppe : silence et fondus en secondes, tolérants, bornés à la minute', () => {
  assert.deepEqual(enveloppe({}), { silence: 0, fonduEntree: 0, fonduSortie: 0 });
  assert.deepEqual(enveloppe(null), { silence: 0, fonduEntree: 0, fonduSortie: 0 });
  assert.deepEqual(enveloppe({ silence: 2, fonduEntree: '1.5', fonduSortie: 3 }), { silence: 2, fonduEntree: 1.5, fonduSortie: 3 });
  assert.deepEqual(enveloppe({ silence: -4, fonduEntree: 'abc', fonduSortie: 900 }), { silence: 0, fonduEntree: 0, fonduSortie: 60 });
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
