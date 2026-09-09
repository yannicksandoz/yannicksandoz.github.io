/**
 * LES MORCEAUX DIFFÉRÉS (core/chunks.js) : reconnaître un morceau qui ne
 * vient pas, le redemander une fois, signaler la version périmée, réchauffer
 * au calme. Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { estErreurDeChunk, importerChunk, rechauffer, signalerVersionPerimee, surVersionPerimee, versionPerimee, ecouterPreloadVite, _reinitialiser } from '../engine/src/core/chunks.js';

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const dormir = async () => {};

console.log('\nles morceaux différés');

await test('estErreurDeChunk : les trois navigateurs, et pas une exception ordinaire', () => {
  assert.ok(estErreurDeChunk(new TypeError('Failed to fetch dynamically imported module: https://x/assets/GLTFLoader-abc.js')));
  assert.ok(estErreurDeChunk(new TypeError('Importing a module script failed.')));
  assert.ok(estErreurDeChunk(new TypeError('error loading dynamically imported module: https://x/a.js')));
  assert.ok(estErreurDeChunk({ code: 'version-perimee' }));
  assert.equal(estErreurDeChunk(new RangeError('Maximum call stack size exceeded')), false);
  assert.equal(estErreurDeChunk(null), false);
});

await test('importerChunk : un creux réseau, puis ça vient — un seul nouvel essai', async () => {
  _reinitialiser();
  let n = 0;
  const r = await importerChunk(async () => { n++; if (n === 1) throw new TypeError('Failed to fetch dynamically imported module'); return 'module'; }, { dormir });
  assert.equal(r, 'module'); assert.equal(n, 2); assert.equal(versionPerimee(), false);
});

await test('importerChunk : manque toujours → version périmée signalée une fois, erreur code version-perimee', async () => {
  _reinitialiser();
  const signaux = [];
  surVersionPerimee((cause) => signaux.push(cause?.message ?? 'x'));
  let n = 0;
  await assert.rejects(importerChunk(async () => { n++; throw new TypeError('Importing a module script failed.'); }, { dormir }), (e) => e.code === 'version-perimee' && /périmée/.test(e.message));
  assert.equal(n, 2);
  assert.equal(versionPerimee(), true);
  assert.equal(signaux.length, 1);
  // un second échec ne resignale pas
  await assert.rejects(importerChunk(async () => { throw new TypeError('Importing a module script failed.'); }, { dormir }));
  assert.equal(signaux.length, 1);
  // s'abonner après coup : rappelé tout de suite
  let tard = 0; surVersionPerimee(() => tard++); assert.equal(tard, 1);
});

await test('importerChunk : une exception DU module remonte telle quelle, sans nouvel essai ni signal', async () => {
  _reinitialiser();
  let n = 0;
  await assert.rejects(importerChunk(async () => { n++; throw new RangeError('boum'); }, { dormir }), RangeError);
  assert.equal(n, 1); assert.equal(versionPerimee(), false);
});

await test('rechauffer : les chargeurs l\'un après l\'autre, au calme, bilan sans lever', async () => {
  const ordre = [];
  const bilan = await rechauffer([
    async () => { ordre.push('a'); },
    async () => { ordre.push('b'); throw new Error('non'); },
    async () => { ordre.push('c'); }
  ], { delai: 0, planifier: (fn) => fn() });
  assert.deepEqual(ordre, ['a', 'b', 'c']);
  assert.deepEqual(bilan, [true, false, true]);
});

await test('ecouterPreloadVite : l\'événement de Vite signale la version périmée', () => {
  _reinitialiser();
  const ecouteurs = {};
  const cible = { addEventListener: (n, fn) => { ecouteurs[n] = fn; }, removeEventListener: (n) => { delete ecouteurs[n]; } };
  const off = ecouterPreloadVite(cible);
  ecouteurs['vite:preloadError']({ payload: new Error('chunk') });
  assert.equal(versionPerimee(), true);
  off(); assert.equal(ecouteurs['vite:preloadError'], undefined);
  assert.equal(signalerVersionPerimee(), false);   // déjà signalé
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
