/**
 * LES CRANS (core/crans.js) : l'ordre dans lequel la qualité cède, l'état
 * plat qu'ils lisent, le plancher de densité, le mode économe et sa mémoire.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { FINITION, SURVIE, ECONOME_CRANS, prochainCran, etatDe, densiteSuivante, ECONOME, lireEconome, ecrireEconome, CLE_ECONOME, lireGouverneur, lireProfil } from '../engine/src/core/crans.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles crans');

test('le gouverneur n\'a plus que la densité : finition à 1, survie à 0,75 — jamais l\'image ni le son', () => {
  assert.deepEqual(FINITION.map((c) => c.cle), ['densite1']);
  assert.deepEqual(SURVIE.map((c) => c.cle), ['densite']);
  for (const c of [...FINITION, ...SURVIE, ...ECONOME_CRANS]) assert.ok(c.dit && typeof c.si === 'function');
  // aucun cran du gouverneur ne touche à ce qui se voit
  const plein = { msaa: 4, gtao: true, ombres: true, isf: 512, etendues: 8, apparitions: true, pixelRatio: 1, grain: true, bloom: true };
  assert.equal(prochainCran(plein, FINITION), null);
  assert.equal(prochainCran({ ...plein, pixelRatio: 2 }, FINITION).cle, 'densite1');
  assert.equal(prochainCran({ ...plein, pixelRatio: 1.25 }, FINITION).cle, 'densite1');
});

test('le mode économe garde tous les anciens crans, dans l\'ordre', () => {
  const e = { msaa: 4, gtao: true, ombres: true, isf: 512, etendues: 2, apparitions: true, pixelRatio: 2, grain: true, bloom: true };
  const suite = [];
  let c;
  while ((c = prochainCran(e, ECONOME_CRANS))) {
    suite.push(c.cle);
    if (c.cle === 'msaa2') e.msaa = 2; else if (c.cle === 'msaa0') e.msaa = 0; else if (c.cle === 'gtao') e.gtao = false;
    else if (c.cle === 'ombres') e.ombres = false; else if (c.cle === 'isf') e.isf = 256; else if (c.cle === 'apparitions') e.apparitions = false;
    else if (c.cle === 'etendues') e.etendues = 0;
    else if (c.cle === 'densite1') e.pixelRatio = 1;
    else if (c.cle === 'densite') e.pixelRatio = densiteSuivante(e.pixelRatio);
    else if (c.cle === 'grain') e.grain = false; else if (c.cle === 'bloom') e.bloom = false;
    if (suite.length > 20) throw new Error('boucle');
  }
  assert.deepEqual(suite, ['msaa2', 'msaa0', 'gtao', 'ombres', 'isf', 'etendues', 'apparitions', 'densite1', 'densite', 'grain', 'bloom']);
  assert.equal(prochainCran(e, ECONOME_CRANS), null);
});

test('la survie : densité sous le natif jusqu\'à 0,75, puis rien', () => {
  assert.equal(prochainCran({ pixelRatio: 1, grain: true, bloom: true }, SURVIE).cle, 'densite');
  assert.equal(prochainCran({ pixelRatio: 0.75, grain: true, bloom: true }, SURVIE), null);
  assert.equal(densiteSuivante(1), 0.75);
  assert.equal(densiteSuivante(1.25), 1);
  assert.equal(densiteSuivante(0.75), 0.75);
  assert.equal(densiteSuivante(0.8), 0.75);
});

test('etatDe lit le profil et ce qui vit dans l\'app, avec des défauts sûrs', () => {
  const e = etatDe({ msaa: 4, shadows: true, isfResolution: 512, pixelRatio: 2, grain: true }, { gtao: { enabled: true }, vistas: { live: true }, sortie: { bloomActif: true } });
  assert.deepEqual(e, { msaa: 4, gtao: true, ombres: true, isf: 512, apparitions: true, etendues: 0, pixelRatio: 2, grain: true, bloom: true });
  assert.deepEqual(etatDe(null, null), { msaa: 0, gtao: false, ombres: false, isf: 512, apparitions: false, etendues: 0, pixelRatio: 1, grain: false, bloom: false });
});

test('le mode économe : tout en bas, et sa mémoire (?eco, ?eco=0, le stockage)', () => {
  assert.equal(ECONOME.msaa, 0); assert.equal(ECONOME.gtao, false); assert.equal(ECONOME.shadows, false);
  assert.equal(ECONOME.isfResolution, 256); assert.equal(ECONOME.pixelRatio, 1); assert.equal(ECONOME.nettete, 0.5);
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  assert.equal(lireEconome('', stockage), false);
  assert.equal(lireEconome('?eco', stockage), true);
  // le gouverneur ne se fige que sur demande explicite (sondes)
  assert.equal(lireGouverneur(''), true);
  assert.equal(lireGouverneur('?eco'), true);
  assert.equal(lireGouverneur('?gouverneur=0'), false);
  assert.equal(lireGouverneur('?gouverneur=non'), false);
  assert.equal(lireGouverneur('?gouverneur=1'), true);
  // le profil forcé, pour mesurer l'image de bureau sur un téléphone
  assert.equal(lireProfil(''), null);
  assert.equal(lireProfil('?profil=desktop&perf=1'), 'desktop');
  assert.equal(lireProfil('?profil=bureau'), 'desktop');
  assert.equal(lireProfil('?profil=mobile'), 'mobile');
  assert.equal(lireProfil('?profil=autre'), null);
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
