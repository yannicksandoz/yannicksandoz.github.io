/**
 * LA TAILLE DU TEXTE (core/taille-texte.js) : trois crans, mémorisés,
 * appliqués à la racine — et jamais une valeur inconnue.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { TAILLES, CLE_TAILLE, normaliserTaille, pourcentDe, lireTaille, ecrireTaille, appliquerTaille }
  from '../engine/src/core/taille-texte.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

// un stockage de poche
const disque = new Map();
const stockage = { getItem: (k) => disque.get(k) ?? null, setItem: (k, v) => disque.set(k, String(v)), removeItem: (k) => disque.delete(k) };
// une racine de poche
const racine = { style: {}, dataset: {} };

console.log('\nla taille du texte');

test('trois crans, du plus petit au plus grand', () => {
  assert.deepEqual(TAILLES, ['normale', 'grande', 'tresgrande']);
  assert.equal(pourcentDe('normale'), 100);
  assert.ok(pourcentDe('grande') > 100 && pourcentDe('tresgrande') > pourcentDe('grande'));
});

test('une valeur inconnue vaut « normale »', () => {
  assert.equal(normaliserTaille('géante'), 'normale');
  assert.equal(normaliserTaille(null), 'normale');
  assert.equal(pourcentDe(undefined), 100);
});

test('mémoriser : « normale » efface la clé, les autres l’écrivent', () => {
  ecrireTaille('grande', stockage);
  assert.equal(disque.get(CLE_TAILLE), 'grande');
  assert.equal(lireTaille(stockage), 'grande');
  ecrireTaille('normale', stockage);
  assert.equal(disque.has(CLE_TAILLE), false);
  assert.equal(lireTaille(stockage), 'normale');
  ecrireTaille('n’importe quoi', stockage);
  assert.equal(disque.has(CLE_TAILLE), false, 'une valeur inconnue ne s’écrit pas');
});

test('un stockage qui refuse ou qui manque : « normale », sans erreur', () => {
  const refuse = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); }, removeItem() {} };
  assert.equal(lireTaille(refuse), 'normale');
  assert.doesNotThrow(() => ecrireTaille('grande', refuse));
  assert.equal(lireTaille({ getItem: () => null }), 'normale');
});

test('appliquer : la racine prend le pourcentage, rien quand c’est normal', () => {
  assert.equal(appliquerTaille('tresgrande', racine), 136);
  assert.equal(racine.style.fontSize, '136%');
  assert.equal(racine.dataset.taille, 'tresgrande');
  assert.equal(appliquerTaille('normale', racine), 100);
  assert.equal(racine.style.fontSize, '', 'la taille par défaut du navigateur reprend');
  assert.equal(appliquerTaille('grande', null), 118, 'sans document (tests) : le pourcentage seulement');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
