/**
 * OÙ SONT LES CHOSES (core/orientation.js) : secteurs, distances, pivot —
 * la visite audio dit « à gauche, 12 m » et ne doit pas se tromper de côté.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { SECTEURS, angleRelatif, secteur, distanceArrondie, reperer, pivoter, classerParDistance }
  from '../engine/src/core/orientation.js';
import { visiteAudioPreferee, ecrireVisiteAudio, lireReperes, ecrireReperes, reperesActifs }
  from '../engine/src/core/preferences-visite.js';
import { motif, NOMS } from '../engine/src/core/earcons.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

// l'auditeur à l'origine, regardant vers -z (le repère three.js : devant lui, z diminue)
const moi = { x: 0, y: 1.7, z: 0 };
const regard = { x: 0, y: 1.7, z: -10 };

console.log('\noù sont les choses');

test('huit secteurs, de devant à devant-gauche, dans le sens horaire', () => {
  assert.equal(SECTEURS.length, 8);
  assert.equal(SECTEURS[0], 'devant');
  assert.equal(SECTEURS[2], 'droite');
  assert.equal(SECTEURS[4], 'derriere');
  assert.equal(SECTEURS[6], 'gauche');
});

test('devant, derrière, à droite, à gauche — dans le repère three.js', () => {
  assert.equal(secteur(angleRelatif(moi, regard, { x: 0, z: -5 })), 'devant');
  assert.equal(secteur(angleRelatif(moi, regard, { x: 0, z: 5 })), 'derriere');
  assert.equal(secteur(angleRelatif(moi, regard, { x: 5, z: 0 })), 'droite', 'x positif est à droite quand on regarde -z');
  assert.equal(secteur(angleRelatif(moi, regard, { x: -5, z: 0 })), 'gauche');
  assert.equal(secteur(angleRelatif(moi, regard, { x: 5, z: -5 })), 'devant-droite');
  assert.equal(secteur(angleRelatif(moi, regard, { x: -5, z: 5 })), 'derriere-gauche');
});

test('le regard tourné : les secteurs suivent', () => {
  // je regarde vers +x : ce qui est en -z est à ma gauche
  const vers = { x: 10, y: 1.7, z: 0 };
  assert.equal(secteur(angleRelatif(moi, vers, { x: 0, z: -5 })), 'gauche');
  assert.equal(secteur(angleRelatif(moi, vers, { x: 5, z: 0 })), 'devant');
});

test('les distances : au sol, en mètres entiers, « moins d\'un mètre » en dessous', () => {
  assert.equal(reperer(moi, regard, { x: 3, y: 4, z: -4 }).distance, 5, 'la hauteur ne compte pas');
  assert.equal(distanceArrondie(12.4), '12 m');
  assert.equal(distanceArrondie(0.6, 'tout près'), 'tout près');
  assert.equal(distanceArrondie(NaN), '');
});

test('pivoter de 90° à droite : ce qui était à droite passe devant', () => {
  const r = pivoter(moi, regard, 90);
  assert.ok(Math.abs(r.x - 10) < 1e-9 && Math.abs(r.z) < 1e-9, `regard attendu vers +x, obtenu ${JSON.stringify(r)}`);
  assert.equal(secteur(angleRelatif(moi, r, { x: 5, z: 0 })), 'devant');
  const g = pivoter(moi, regard, -45);
  assert.equal(secteur(angleRelatif(moi, g, { x: -5, z: -5 })), 'devant');
  assert.equal(r.y, regard.y, 'la hauteur du regard ne bouge pas');
});

test('classer par distance : la plus proche d\'abord, chacune avec son secteur', () => {
  const c = classerParDistance(moi, regard, [
    { id: 'loin', position: { x: 0, z: -20 } }, { id: 'pres', position: { x: 2, z: 0 } }, { id: 'milieu', position: { x: -6, z: -6 } }
  ]);
  assert.deepEqual(c.map((x) => x.id), ['pres', 'milieu', 'loin']);
  assert.equal(c[0].secteur, 'droite');
  assert.equal(c[1].secteur, 'devant-gauche');
});

console.log('\nles préférences de visite');
const disque = new Map();
const stockage = { getItem: (k) => disque.get(k) ?? null, setItem: (k, v) => disque.set(k, String(v)), removeItem: (k) => disque.delete(k) };

test('la visite audio : par le lien, ou par la mémoire', () => {
  assert.equal(visiteAudioPreferee('', stockage), false);
  assert.equal(visiteAudioPreferee('?mode=audio', stockage), true);
  assert.equal(visiteAudioPreferee('?room=jardin&mode=audio', stockage), true);
  ecrireVisiteAudio(true, stockage);
  assert.equal(visiteAudioPreferee('?room=jardin', stockage), true);
  ecrireVisiteAudio(false, stockage);
  assert.equal(disque.size, 0, 'refuser efface la clé');
  assert.equal(visiteAudioPreferee('', stockage), false);
});

test('les repères sonores : oui en visite audio, non en 3D, sauf choix', () => {
  assert.equal(lireReperes(stockage), null);
  assert.equal(reperesActifs(null, true), true);
  assert.equal(reperesActifs(null, false), false);
  ecrireReperes('non', stockage);
  assert.equal(lireReperes(stockage), 'non');
  assert.equal(reperesActifs('non', true), false);
  ecrireReperes('oui', stockage);
  assert.equal(reperesActifs(lireReperes(stockage), false), true);
  ecrireReperes(null, stockage);
  assert.equal(lireReperes(stockage), null);
});

test('un stockage qui refuse : des défauts, pas d\'erreur', () => {
  const refuse = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); }, removeItem() { throw new Error('refusé'); } };
  assert.equal(visiteAudioPreferee('', refuse), false);
  assert.doesNotThrow(() => ecrireVisiteAudio(true, refuse));
  assert.equal(lireReperes(refuse), null);
});

console.log('\nles repères sonores');
test('cinq motifs, chacun fait de notes courtes et audibles', () => {
  assert.deepEqual(NOMS, ['decouverte', 'jeton', 'porte', 'fermee', 'fin']);
  for (const n of NOMS) {
    const m = motif(n);
    assert.ok(m.length >= 2, `${n} : au moins deux notes`);
    for (const note of m) assert.ok(note.f >= 200 && note.f <= 2000 && note.d > 0.04 && note.d < 0.3 && note.t >= 0, `${n} : ${JSON.stringify(note)}`);
    const fin = Math.max(...m.map((x) => x.t + x.d));
    assert.ok(fin < 0.5, `${n} dure moins d'une demi-seconde (${fin})`);
  }
  assert.equal(motif('inconnu'), null);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
