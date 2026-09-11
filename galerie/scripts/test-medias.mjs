/**
 * OÙ VIVENT LES MÉDIAS — la résolution des chemins, réglable par reglages.json.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { estSon, resoudreMedia, joindre, normaliserMedias } from '../engine/src/core/medias.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};

console.log('\nles médias');
test('estSon : fichiers audio, manifestes et dossiers de fragments ; pas les images', () => {
  for (const p of ['audio/a.wav', 'assets/x.webm', 'assets/x.m4a', 'x.fragments.json', 'assets/x.frag/003.webm', 'a.WAV?v=2']) {
    assert.ok(estSon(p), p);
  }
  for (const p of ['assets/x.jpg', 'library/models/banc.glb', 'works/a.json', '']) assert.ok(!estSon(p), p);
});
test('sans réglage : la base de la page', () => {
  assert.equal(resoudreMedia('assets/x.webm', undefined, './'), './assets/x.webm');
  assert.equal(resoudreMedia('assets/x.webm', {}, '/galerie/'), '/galerie/assets/x.webm');
});
test('medias.sons : seuls les sons partent vers l\'hôte, une barre exactement', () => {
  const m = { sons: 'https://sons.exemple.org/galerie/' };
  assert.equal(resoudreMedia('assets/x.webm', m), 'https://sons.exemple.org/galerie/assets/x.webm');
  assert.equal(resoudreMedia('assets/x.fragments.json', m), 'https://sons.exemple.org/galerie/assets/x.fragments.json');
  assert.equal(resoudreMedia('assets/x.frag/{i}.webm', m), 'https://sons.exemple.org/galerie/assets/x.frag/{i}.webm');
  assert.equal(resoudreMedia('assets/photo.jpg', m, './'), './assets/photo.jpg');
  assert.equal(resoudreMedia('assets/x.webm', { sons: 'https://h.org' }), 'https://h.org/assets/x.webm');
});
test('medias.base : tout le reste ; les sons suivent sons d\'abord, base sinon', () => {
  const m = { base: 'https://cdn.exemple.org/g' };
  assert.equal(resoudreMedia('assets/photo.jpg', m), 'https://cdn.exemple.org/g/assets/photo.jpg');
  assert.equal(resoudreMedia('assets/x.webm', m), 'https://cdn.exemple.org/g/assets/x.webm');
  assert.equal(resoudreMedia('assets/x.webm', { ...m, sons: 'https://s.org/' }), 'https://s.org/assets/x.webm');
});
test('les absolus et les chemins racine ne bougent pas', () => {
  const m = { sons: 'https://s.org/', base: 'https://b.org/' };
  assert.equal(resoudreMedia('https://ailleurs.org/a.mp3', m), 'https://ailleurs.org/a.mp3');
  assert.equal(resoudreMedia('//ailleurs.org/a.mp3', m), '//ailleurs.org/a.mp3');
  assert.equal(resoudreMedia('/local/a.mp3', m), '/local/a.mp3');
});
test('joindre et normaliser', () => {
  assert.equal(joindre('https://h/', './a/b'), 'https://h/a/b');
  assert.deepEqual(normaliserMedias({ sons: '  https://s/ ', base: '', autre: 1 }), { sons: 'https://s/' });
  assert.deepEqual(normaliserMedias(null), {});
});

console.log(`\n${ko ? '✗' : '✓'} test-medias : ${ok} ok, ${ko} ko`);
if (ko) process.exit(1);
