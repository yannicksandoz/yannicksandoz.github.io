/**
 * LE FORMAT D'UN SON — le choix au chargement (formats-audio.js).
 *
 * L'ambiance de l'entrée pesait 7,6 Mo ; le même son en Opus tient en 3, en
 * AAC en 4, mais aucun n'est lu partout. Le JSON garde `file` et nomme des
 * `formats` ; le moteur choisit selon ce que le navigateur sait lire. Ce
 * choix est une fonction pure : la voici sous test, avec des navigateurs
 * de carton (un prédicat de support par cas).
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { choisirSource, supportAudio, chargerAvecRepli, FORMATS } from '../engine/src/core/formats-audio.js';

let ok = 0;
let ko = 0;
const groupe = (titre) => console.log(`\n${titre}`);
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};

const piste = { file: 'assets/x.mp3', formats: { webm: 'assets/x.webm', m4a: 'assets/x.m4a' } };
const chrome = (t) => t.includes('opus') || t.includes('mp4a');   // lit les deux
const safari = (t) => t.includes('mp4a');                         // AAC seulement
const vieux = () => false;                                        // ni l'un ni l'autre

groupe('le choix suit le navigateur, dans l\'ordre Opus, AAC, origine');

test('un navigateur qui lit Opus reçoit le WebM (le plus léger)', () => {
  assert.equal(choisirSource(piste, chrome), 'assets/x.webm');
});

test('Safari, qui ne lit que l\'AAC, reçoit le MP4', () => {
  assert.equal(choisirSource(piste, safari), 'assets/x.m4a');
});

test('un navigateur qui ne lit rien de tout ça reçoit le fichier d\'origine', () => {
  assert.equal(choisirSource(piste, vieux), 'assets/x.mp3');
});

groupe('rien ne casse quand les formats manquent ou mentent');

test('sans `formats`, le fichier d\'origine — c\'est le cas de presque toutes les pistes', () => {
  assert.equal(choisirSource({ file: 'audio/voix.wav' }, chrome), 'audio/voix.wav');
});

test('un format nommé mais vide, ou d\'un type inattendu, est ignoré', () => {
  assert.equal(choisirSource({ file: 'a.mp3', formats: { webm: '', m4a: 42 } }, chrome), 'a.mp3');
  assert.equal(choisirSource({ file: 'a.mp3', formats: 'n/a' }, chrome), 'a.mp3');
});

test('sans prédicat de support, ou sans piste, on ne devine pas', () => {
  assert.equal(choisirSource(piste, null), 'assets/x.mp3');
  assert.equal(choisirSource(null, chrome), null);
});

test('seul le m4a présent : Chrome le prend aussi, plutôt que l\'origine', () => {
  assert.equal(choisirSource({ file: 'a.mp3', formats: { m4a: 'a.m4a' } }, chrome), 'a.m4a');
});

groupe('la détection réelle');

test('sans DOM (ici, au nœud), rien n\'est supporté : l\'origine, jamais une exception', () => {
  const supporte = supportAudio();
  for (const f of FORMATS) assert.equal(supporte(f.type), false);
  assert.equal(choisirSource(piste, supporte), 'assets/x.mp3');
});

test('les types testés sont ceux des deux conteneurs, Opus d\'abord', () => {
  assert.deepEqual(FORMATS.map((f) => f.cle), ['webm', 'm4a']);
  assert.ok(FORMATS[0].type.includes('opus') && FORMATS[1].type.includes('mp4a.40.2'));
});

groupe('le repli : quand l\'alternative choisie ne se charge pas');

const testAsync = async (nom, fn) => {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
};
// un chargeur de carton : lit tout sauf les chemins listés
const chargeur = (illisibles, journal = []) => async (url) => {
  journal.push(url);
  if (illisibles.includes(url)) throw new Error('EncodingError: ' + url);
  return { buffer: url };
};

await testAsync('l\'alternative se lit : c\'est elle, et l\'origine n\'est jamais demandée', async () => {
  const journal = [];
  const r = await chargerAvecRepli(chargeur([], journal), 'a.webm', 'a.mp3');
  assert.deepEqual(r, { buffer: { buffer: 'a.webm' }, url: 'a.webm' });
  assert.deepEqual(journal, ['a.webm']);
});

await testAsync('l\'alternative échoue : on prévient, on recharge l\'origine, et l\'URL rendue est la sienne', async () => {
  const journal = [];
  const avertissements = [];
  const r = await chargerAvecRepli(chargeur(['a.webm'], journal), 'a.webm', 'a.mp3', (e) => avertissements.push(e.message));
  assert.equal(r.url, 'a.mp3');
  assert.deepEqual(journal, ['a.webm', 'a.mp3']);
  assert.equal(avertissements.length, 1);
});

await testAsync('sans origine distincte, l\'erreur remonte telle quelle (pas de double essai)', async () => {
  const journal = [];
  await assert.rejects(chargerAvecRepli(chargeur(['a.mp3'], journal), 'a.mp3', 'a.mp3'), /a\.mp3/);
  await assert.rejects(chargerAvecRepli(chargeur(['a.mp3'], journal), 'a.mp3', null), /a\.mp3/);
  assert.deepEqual(journal, ['a.mp3', 'a.mp3']);
});

await testAsync('l\'origine échoue aussi : l\'erreur de l\'origine remonte', async () => {
  await assert.rejects(chargerAvecRepli(chargeur(['a.webm', 'a.mp3']), 'a.webm', 'a.mp3'), /a\.mp3/);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
