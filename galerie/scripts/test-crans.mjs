/**
 * LES CRANS (core/crans.js) : l'ordre dans lequel la qualité cède, l'état
 * plat qu'ils lisent, le plancher de densité, le mode économe et sa mémoire.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { FINITION, SURVIE, prochainCran, etatDe, densiteSuivante, ECONOME, lireEconome, ecrireEconome, CLE_ECONOME } from '../engine/src/core/crans.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles crans');

test('la finition cède dans l\'ordre : anticrénelage, occlusion, ombres, écrans ISF, apparitions, densité 1', () => {
  assert.deepEqual(FINITION.map((c) => c.cle), ['msaa2', 'msaa0', 'gtao', 'ombres', 'isf', 'apparitions', 'densite1']);
  assert.deepEqual(SURVIE.map((c) => c.cle), ['densite', 'grain', 'bloom']);
  for (const c of [...FINITION, ...SURVIE]) assert.ok(c.dit && typeof c.si === 'function');
});

test('prochainCran : le premier cran que l\'état permet, puis le suivant, puis rien', () => {
  const e = { msaa: 4, gtao: true, ombres: true, isf: 512, apparitions: true, pixelRatio: 2, grain: true, bloom: true };
  const suite = [];
  let c;
  while ((c = prochainCran(e, FINITION))) {
    suite.push(c.cle);
    if (c.cle === 'msaa2') e.msaa = 2; else if (c.cle === 'msaa0') e.msaa = 0; else if (c.cle === 'gtao') e.gtao = false;
    else if (c.cle === 'ombres') e.ombres = false; else if (c.cle === 'isf') e.isf = 256; else if (c.cle === 'apparitions') e.apparitions = false;
    else if (c.cle === 'densite1') e.pixelRatio = 1;
    if (suite.length > 20) throw new Error('boucle');
  }
  assert.deepEqual(suite, ['msaa2', 'msaa0', 'gtao', 'ombres', 'isf', 'apparitions', 'densite1']);
  assert.equal(prochainCran(e, FINITION), null);
  // un profil déjà bas (mobile) saute ce qu'il n'a pas
  assert.equal(prochainCran({ msaa: 2, gtao: false, ombres: false, isf: 256, apparitions: false, pixelRatio: 1 }, FINITION).cle, 'msaa0');
  assert.equal(prochainCran({ msaa: 0, gtao: false, ombres: false, isf: 256, apparitions: false, pixelRatio: 1 }, FINITION), null);
});

test('la survie : densité sous le natif jusqu\'à 0,75, puis grain, puis bloom', () => {
  assert.equal(prochainCran({ pixelRatio: 1, grain: true, bloom: true }, SURVIE).cle, 'densite');
  assert.equal(prochainCran({ pixelRatio: 0.75, grain: true, bloom: true }, SURVIE).cle, 'grain');
  assert.equal(prochainCran({ pixelRatio: 0.75, grain: false, bloom: true }, SURVIE).cle, 'bloom');
  assert.equal(prochainCran({ pixelRatio: 0.75, grain: false, bloom: false }, SURVIE), null);
  assert.equal(densiteSuivante(1), 0.75);
  assert.equal(densiteSuivante(1.25), 1);
  assert.equal(densiteSuivante(0.75), 0.75);
  assert.equal(densiteSuivante(0.8), 0.75);
});

test('etatDe lit le profil et ce qui vit dans l\'app, avec des défauts sûrs', () => {
  const e = etatDe({ msaa: 4, shadows: true, isfResolution: 512, pixelRatio: 2, grain: true }, { gtao: { enabled: true }, vistas: { live: true }, sortie: { bloomActif: true } });
  assert.deepEqual(e, { msaa: 4, gtao: true, ombres: true, isf: 512, apparitions: true, pixelRatio: 2, grain: true, bloom: true });
  assert.deepEqual(etatDe(null, null), { msaa: 0, gtao: false, ombres: false, isf: 512, apparitions: false, pixelRatio: 1, grain: false, bloom: false });
});

test('le mode économe : tout en bas, et sa mémoire (?eco, ?eco=0, le stockage)', () => {
  assert.equal(ECONOME.msaa, 0); assert.equal(ECONOME.gtao, false); assert.equal(ECONOME.shadows, false);
  assert.equal(ECONOME.isfResolution, 256); assert.equal(ECONOME.pixelRatio, 1); assert.equal(ECONOME.nettete, 0.5);
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  assert.equal(lireEconome('', stockage), false);
  assert.equal(lireEconome('?eco', stockage), true);
  assert.equal(lireEconome('?eco=1&room=x', stockage), true);
  assert.equal(lireEconome('?eco=0', stockage), false);
  ecrireEconome(true, stockage);
  assert.equal(memoire.get(CLE_ECONOME), '1');
  assert.equal(lireEconome('', stockage), true);
  assert.equal(lireEconome('?eco=0', stockage), false);   // l'URL gagne sur la mémoire
  ecrireEconome(false, stockage);
  assert.equal(lireEconome('', stockage), false);
  // stockage refusé (navigation privée) : pas d'exception
  const muet = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); } };
  assert.equal(lireEconome('', muet), false);
  assert.equal(ecrireEconome(true, muet), false);
  assert.equal(lireEconome('', null), false);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
