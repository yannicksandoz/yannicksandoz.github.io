/**
 * L'IMAGE ENRICHIE (ui/ImageRiche.js, core/crans.js) : à qui on la propose,
 * comment elle se retient, ce que l'adresse impose.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { proposable, CLE_PROPOSE } from '../engine/src/ui/ImageRiche.js';
import { lireRiche, ecrireRiche, CLE_RICHE, lireProfil } from '../engine/src/core/crans.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nl\'image enrichie');

test('on ne la propose qu\'à une souris, sur une image unique, sans GPU faible, une seule fois', () => {
  const base = { isMobile: false, riche: false, econome: false, gpuFaible: false, dejaPropose: false, force: null };
  assert.equal(proposable(base), true);
  assert.equal(proposable({ ...base, isMobile: true }), false);
  assert.equal(proposable({ ...base, riche: true }), false);
  assert.equal(proposable({ ...base, econome: true }), false);
  assert.equal(proposable({ ...base, gpuFaible: true }), false);
  assert.equal(proposable({ ...base, dejaPropose: true }), false);
  assert.equal(proposable({ ...base, force: 'unique' }), false);   // une mesure en cours n'est pas une visite
  assert.equal(CLE_PROPOSE, 'galerie-riche-propose');
});

test('la mémoire de l\'image enrichie : l\'adresse gagne, le stockage suit, une panne se tait', () => {
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  assert.equal(lireRiche('', stockage), false);
  assert.equal(lireRiche('?riche', stockage), true);
  assert.equal(lireRiche('?riche=0', stockage), false);
  ecrireRiche(true, stockage);
  assert.equal(memoire.get(CLE_RICHE), '1');
  assert.equal(lireRiche('', stockage), true);
  assert.equal(lireRiche('?riche=non', stockage), false);
  ecrireRiche(false, stockage);
  assert.equal(lireRiche('', stockage), false);
  const muet = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); } };
  assert.equal(lireRiche('', muet), false);
  assert.equal(ecrireRiche(true, muet), false);
});

test('?profil= : unique ou riche, et les anciens noms sont des alias', () => {
  assert.equal(lireProfil('?profil=riche'), 'riche');
  assert.equal(lireProfil('?profil=desktop'), 'riche');
  assert.equal(lireProfil('?profil=unique'), 'unique');
  assert.equal(lireProfil('?profil=mobile'), 'unique');
  assert.equal(lireProfil('?profil=autre'), null);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
