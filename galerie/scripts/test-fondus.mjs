/**
 * LES FONDUS DE LA LUMIÈRE — plus rien ne bascule d'un coup en marchant :
 * les lampes du budget montent et descendent (ombres.js), la sonde
 * d'ambiance glisse vers sa cible (ambiance-salle.js), les lignes retenues
 * pèsent progressivement (lignes-lumiere.js), et deux photos de la sonde de
 * reflets se fondent (reflets.js).
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pasDeFondu, fondreLampes, budgetLampes, DUREE_FONDU } from '../engine/src/core/ombres.js';
import { partDuChemin, majAmbiance, orienterAmbiance, oublierAmbiance, ambianceCourante, uniformesAmbiance, TAU_AMBIANCE } from '../engine/src/core/ambiance-salle.js';
import { reinitialiserLignes, ajouterLigne, majLignes, reglerBudgetLignes, poidsDesLignes, DUREE_FONDU_LIGNES, MAX_LIGNES } from '../engine/src/core/lignes-lumiere.js';
import { DUREE_FONDU_REFLETS } from '../engine/src/core/reflets.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles fondus de la lumière');

test('un pas de fondu : vers 1 quand on veut, vers 0 sinon, borné, en DUREE_FONDU secondes', () => {
  assert.equal(DUREE_FONDU, 0.6);
  assert.equal(pasDeFondu(0, true, 0.3), 0.5);
  assert.equal(pasDeFondu(0.5, true, 0.3), 1);
  assert.equal(pasDeFondu(1, true, 5), 1);
  assert.equal(pasDeFondu(1, false, 0.3), 0.5);
  assert.equal(pasDeFondu(0.1, false, 0.3), 0);
  assert.equal(pasDeFondu(0.2, true, 1, 0), 1);   // durée nulle : immédiat
});

/** Une salle de carton : des lampes ponctuelles portées par des œuvres de carton. */
function salle(positions) {
  const group = new THREE.Group();
  const lampes = positions.map(([x, y, z]) => {
    const l = new THREE.PointLight(0xffffff, 2);
    l.position.set(x, y, z);
    const art = { voulue: 2, appliquerFonduLampe(f) { l.userData.fondu = f; l.intensity = 2 * f; } };
    l.userData.artwork = art;
    group.add(l);
    return l;
  });
  group.updateMatrixWorld(true);
  return { group, lampes };
}

test('le budget DEMANDE, il ne bascule plus : la lampe rendue descend, la demandée monte depuis zéro', () => {
  const { group, lampes } = salle([[0, 2, 0], [10, 2, 0], [20, 2, 0]]);
  const room = { group };
  let bascules = 0;
  budgetLampes(room, new THREE.Vector3(0, 2, 0), { points: 2, cones: 0, surBascule: () => bascules++ });
  assert.deepEqual(lampes.map((l) => l.userData.voulue), [true, true, false]);
  // rien n'a encore bougé d'un coup : toutes visibles, intensités intactes
  assert.deepEqual(lampes.map((l) => l.visible), [true, true, true]);
  // on marche : la troisième devient la plus proche, la première la plus loin
  assert.equal(bascules, 1);                       // la première attribution en est une
  budgetLampes(room, new THREE.Vector3(20, 2, 0), { points: 2, cones: 0, surBascule: () => bascules++ });
  assert.deepEqual(lampes.map((l) => l.userData.voulue), [false, true, true]);
  assert.equal(bascules, 2);
  // la troisième était déjà visible (jamais éteinte) : elle garde son intensité ;
  // la première descend en 0,6 s, image par image
  fondreLampes(room, 0.3);
  assert.equal(lampes[0].userData.fondu, 0.5);
  assert.equal(lampes[0].intensity, 1);
  assert.equal(lampes[0].visible, true);
  assert.equal(fondreLampes(room, 0.3), true);     // elle vient de s'éteindre tout à fait
  assert.equal(lampes[0].visible, false);
  assert.equal(lampes[0].intensity, 0);
  // et on revient : elle se rallume à zéro et monte
  budgetLampes(room, new THREE.Vector3(0, 2, 0), { points: 2, cones: 0 });
  assert.equal(lampes[0].visible, true);
  assert.equal(lampes[0].intensity, 0);
  fondreLampes(room, 0.6);
  assert.equal(lampes[0].intensity, 2);
  assert.equal(fondreLampes(room, 0.6), false);    // plus rien ne bouge
});

test('sous le budget, toutes les lampes sont voulues et rien ne descend', () => {
  const { group, lampes } = salle([[0, 2, 0], [5, 2, 0]]);
  budgetLampes({ group }, new THREE.Vector3(), { points: 4, cones: 0 });
  assert.deepEqual(lampes.map((l) => l.userData.voulue), [true, true]);
  fondreLampes({ group }, 1);
  assert.deepEqual(lampes.map((l) => l.intensity), [2, 2]);
});

test('la sonde d\'ambiance glisse vers sa cible : 95 % du chemin en une seconde, tout de suite la première fois', () => {
  assert.equal(TAU_AMBIANCE, 0.35);
  assert.ok(Math.abs(partDuChemin(1) - 0.943) < 0.01);
  assert.equal(partDuChemin(0), 1);           // sans temps, on saute (les sondes, les tests d'avant)
  assert.equal(partDuChemin(0.1, 0), 1);
  oublierAmbiance();
  const cam = new THREE.PerspectiveCamera(); cam.updateMatrixWorld(true);
  const group = new THREE.Group();
  const l = new THREE.PointLight(0xffffff, 4); l.position.set(0, 3, 0); group.add(l); group.updateMatrixWorld(true);
  const salleA = { group, config: { shell: { width: 10, depth: 10, height: 4 } } };
  majAmbiance(salleA, []);
  orienterAmbiance(cam, 0.016);
  const premiere = ambianceCourante().c0.r;
  assert.ok(premiere > 0, 'la première pose est immédiate');
  // la lampe s'éteint pour le shader (poids 1 → rebond seul) : la cible baisse, MONDE la suit en douceur
  l.visible = false; l.userData.voulue = false;
  majAmbiance(salleA, []);
  const cible = ambianceCourante().cible.r;
  assert.notEqual(cible, premiere);
  orienterAmbiance(cam, 0.1);
  const apres = ambianceCourante().c0.r;
  assert.ok(apres !== premiere && Math.abs(apres - cible) > 0.001, `glisse : ${premiere} → ${apres} vers ${cible}`);
  assert.ok(Math.abs(apres - premiere) < Math.abs(cible - premiere), 'pas encore arrivée');
  for (let i = 0; i < 60; i++) orienterAmbiance(cam, 0.05);
  assert.ok(Math.abs(ambianceCourante().c0.r - cible) < 1e-3, 'arrivée après trois secondes');
  assert.ok(Math.abs(uniformesAmbiance().uAmbianceC0.value.r - cible) < 1e-3);
  oublierAmbiance();
});

test('les lignes : les retenues montent, les rendues descendent, et la couleur suit le poids', () => {
  reinitialiserLignes();
  reglerBudgetLignes(1);
  const scene = new THREE.Scene();
  const objet = new THREE.Object3D(); scene.add(objet); scene.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 0, 0); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  ajouterLigne({ objet, a: [-1, 2, -2], b: [1, 2, -2], couleur: '#ffffff', intensite: 1 });   // proche
  ajouterLigne({ objet, a: [-1, 2, -20], b: [1, 2, -20], couleur: '#ffffff', intensite: 1 }); // loin
  // à l'entrée : la retenue à 1, l'autre à 0, sans fondu depuis le noir
  let n = majLignes(cam, 0.016);
  assert.equal(n, 1);
  assert.deepEqual(poidsDesLignes().map((p) => p.w), [1, 0]);
  // on marche jusqu'à la lointaine : elle devient la retenue, la proche descend
  cam.position.set(0, 0, -20); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  n = majLignes(cam, 0.3);
  const w = poidsDesLignes().map((p) => p.w);
  assert.equal(w[1], 0.5);
  assert.equal(w[0], 0.5);
  assert.equal(n, 2);                          // les deux se transportent le temps du fondu
  n = majLignes(cam, 0.3);
  assert.deepEqual(poidsDesLignes().map((p) => p.w), [0, 1]);
  assert.equal(n, 1);
  assert.equal(DUREE_FONDU_LIGNES, 0.6);
  assert.ok(MAX_LIGNES >= 2);
  reinitialiserLignes();
  reglerBudgetLignes(MAX_LIGNES);
});

test('la sonde de reflets fond deux photos en moins d\'une seconde', () => {
  assert.equal(DUREE_FONDU_REFLETS, 0.8);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
