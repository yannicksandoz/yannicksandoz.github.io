/**
 * LES RÉCENTS DU MENU AJOUTER (editor/state/recents-regles.js).
 *
 * Un récent par TYPE d'objet, le dernier en tête, six au plus ; la recette
 * garde la matière et lâche l'exemplaire (identifiant, position, pistes).
 * Tout au nœud, sans moteur.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { signatureObjet, libelleObjet, recetteDepuis, noterRecent, RECENTS_MAX }
  from '../engine/src/editor/state/recents-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles récents du menu Ajouter');

const cube = { id: 'box', title: 'Cube', position: [1, 0.75, 2], rotation: [0, 30, 0], scale: [1, 1, 1], model: { shape: 'box', size: 1.5, color: '#ff0000' }, modules: [{ type: 'FocusCamera', params: { distance: 6 } }] };
const cubeBleu = { ...cube, id: 'box-2', title: 'Cube (copie)', model: { ...cube.model, color: '#0000ff' } };
const sphere = { id: 'sphere', title: 'Sphère', model: { shape: 'sphere', size: 1.5 } };
const lampe = { id: 'lampe', title: 'Lampe', selfLit: true, lightType: 'point', model: { shape: 'sphere', size: 0.35 } };
const banc = { id: 'banc', title: 'Banc (3)', model: { type: 'gltf', url: 'content/library/banc.glb', source: 'moteur' }, credit: { author: 'x' } };
const shader = { id: 'plasma', title: 'Plasma', model: { type: 'isf', nom: 'Plasma', fichier: 'plasma.fs' } };
const stele = { id: 'stele', title: 'Stèle', model: { shape: 'box' }, stems: [{ file: 'a.mp3', radius: 12 }], baseGain: 0.8, partOf: 'autre' };

test('la signature dit le TYPE : la couleur n\'y entre pas, la source et le nom du shader oui', () => {
  assert.equal(signatureObjet(cube), signatureObjet(cubeBleu));
  assert.notEqual(signatureObjet(cube), signatureObjet(sphere));
  assert.equal(signatureObjet(lampe), 'lampe');
  assert.equal(signatureObjet({ cleDeSalle: { intensity: 2 } }), 'eclairage');
  assert.equal(signatureObjet(banc), 'modele:content/library/banc.glb');
  assert.equal(signatureObjet(shader), 'isf:Plasma');
  assert.equal(signatureObjet({ image: 'x.png' }), 'image');
  assert.equal(signatureObjet({}), 'objet');
});

test('le libellé est lisible dans un menu', () => {
  assert.equal(libelleObjet(cube), 'Cube');
  assert.equal(libelleObjet(cubeBleu), 'Cube');            // sans « (copie) »
  assert.equal(libelleObjet(banc), 'Banc');                // sans « (3) »
  assert.equal(libelleObjet(lampe), 'Lampe');
  assert.equal(libelleObjet(shader), 'Shader Plasma');
  assert.equal(libelleObjet({ model: { shape: 'cone' } }), 'cone');
});

test('la recette garde la matière et lâche l\'exemplaire', () => {
  const r = recetteDepuis(stele);
  assert.equal(r.id, undefined);
  assert.equal(r.position, undefined);
  assert.equal(r.stems, undefined);
  assert.equal(r.baseGain, undefined);
  assert.equal(r.partOf, undefined);
  assert.deepEqual(r.model, { shape: 'box' });
  assert.equal(r.title, 'Stèle');
  const c = recetteDepuis(cubeBleu);
  assert.equal(c.title, 'Cube');
  assert.equal(c.model.color, '#0000ff');
  assert.notEqual(c.model, cubeBleu.model);               // un clone, pas une référence
  assert.deepEqual(recetteDepuis(banc).credit, { author: 'x' });   // l'attribution suit
  assert.equal(recetteDepuis(null), null);
});

test('noter : en tête, un par type, le dernier gagne, six au plus', () => {
  let l = noterRecent([], cube);
  l = noterRecent(l, sphere);
  l = noterRecent(l, lampe);
  assert.deepEqual(l.map((e) => e.libelle), ['Lampe', 'Sphère', 'Cube']);
  l = noterRecent(l, cubeBleu);                            // même type que le cube : remonte, recette neuve
  assert.deepEqual(l.map((e) => e.libelle), ['Cube', 'Lampe', 'Sphère']);
  assert.equal(l[0].recette.model.color, '#0000ff');
  assert.equal(l[0].id, 'box-2');
  assert.equal(l.length, 3);
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) l = noterRecent(l, { id: k, model: { shape: k } });
  assert.equal(l.length, RECENTS_MAX);
  assert.equal(l[0].signature, 'forme:g');
  assert.deepEqual(noterRecent(null, null), []);
  assert.deepEqual(noterRecent([{ signature: 'x', libelle: 'X' }], null).length, 1);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
