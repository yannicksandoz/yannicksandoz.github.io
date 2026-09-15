/**
 * LA DERNIÈRE VISITE (core/Memoire.js) : la pièce retenue, la ligne de
 * l'accueil, et ce qu'une mémoire vide ou abîmée n'a pas à dire.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';

// un localStorage de poche : ce que le navigateur donnerait, en mémoire
const disque = new Map();
globalThis.localStorage = {
  getItem: (k) => disque.get(k) ?? null,
  setItem: (k, v) => disque.set(k, String(v)),
  removeItem: (k) => disque.delete(k)
};
const { Memoire, MemoireOuverte, resumeReprise } = await import('../engine/src/core/Memoire.js');

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

const ROOMS = [{ id: 'entree', title: 'Entrée' }, { id: 'bibliotheque', title: 'Bibliothèque' }, { id: 'labo' }];
const OEUVRES = [{ id: 'lune' }, { id: 'marees' }, { id: 'nebuleuse' }, { id: 'stele-1' }];

console.log('\nla dernière visite');

test('une mémoire neuve n\'a pas de dernière pièce, et l\'accueil n\'a rien à dire', () => {
  disque.clear();
  const m = new Memoire();
  assert.equal(m.derniere, null);
  assert.equal(resumeReprise(m, ROOMS, OEUVRES), null);
  assert.equal(resumeReprise(null, ROOMS, OEUVRES), null);
  assert.deepEqual(Object.keys(m.serialiser()), ['v', 'pieces', 'portes', 'oeuvres', 'revelees', 'jetons']);
});

test('la dernière pièce est la dernière notée, même déjà connue', () => {
  disque.clear();
  const m = new Memoire();
  assert.equal(m.noter('pieces', 'entree'), true);
  assert.equal(m.noter('pieces', 'bibliotheque'), true);
  assert.equal(m.derniere, 'bibliotheque');
  // revenir dans une pièce connue : rien de nouveau sur la carte, mais
  // c'est bien là qu'on était en dernier
  assert.equal(m.noter('pieces', 'entree'), false);
  assert.equal(m.derniere, 'entree');
  assert.equal(JSON.parse(disque.get('galerie-visite')).derniere, 'entree');
});

test('elle survit au rechargement, et l\'accueil la dit avec le compte des œuvres', () => {
  disque.clear();
  const m = new Memoire();
  m.noter('pieces', 'bibliotheque');
  m.noter('oeuvres', 'lune');
  m.noter('oeuvres', 'marees');
  m.noter('oeuvres', 'disparue');   // une œuvre retirée du contenu depuis
  const relue = new Memoire();
  assert.equal(relue.derniere, 'bibliotheque');
  assert.deepEqual(resumeReprise(relue, ROOMS, OEUVRES), { salle: 'Bibliothèque', trouvees: 2, total: 4 });
});

test('une pièce sans titre se dit par son identifiant ; une pièce disparue, par rien', () => {
  disque.clear();
  const m = new Memoire();
  m.noter('pieces', 'labo');
  assert.deepEqual(resumeReprise(m, ROOMS, OEUVRES), { salle: 'labo', trouvees: 0, total: 4 });
  m.noter('pieces', 'annexe-retiree');
  assert.equal(resumeReprise(m, ROOMS, OEUVRES), null);
});

test('« recommencer » oublie aussi la dernière pièce', () => {
  disque.clear();
  const m = new Memoire();
  m.noter('pieces', 'labo');
  m.oublier();
  assert.equal(m.derniere, null);
  assert.equal(resumeReprise(m, ROOMS, OEUVRES), null);
  assert.equal(new Memoire().derniere, null);
});

test('une mémoire abîmée ne dit rien de faux', () => {
  disque.set('galerie-visite', '{"v":1,"pieces":["labo"],"derniere":42}');
  assert.equal(new Memoire().derniere, null);
  disque.set('galerie-visite', '{"v":1,"derniere":""}');
  assert.equal(new Memoire().derniere, null);
});

test('la mémoire ouverte (visite guidée) n\'a jamais de dernière pièce', () => {
  const m = new MemoireOuverte();
  m.noter('pieces', 'labo');
  assert.equal(m.derniere, null);
  assert.equal(resumeReprise(m, ROOMS, OEUVRES), null);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
