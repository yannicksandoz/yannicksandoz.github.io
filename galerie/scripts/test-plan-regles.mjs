/**
 * LE PLAN CLIQUABLE (editor/state/plan-regles.js).
 *
 * Tirer un trait d'une pièce à l'autre sur le plan pose l'aller sur le mur
 * qui fait face à la voisine, le retour sur le mur d'en face de celle-ci,
 * les deux arrivées devant les portes ; un mur absent cède à son voisin,
 * une pièce sans coque prend l'empreinte du plan, un portail qui gêne
 * décale la porte. Tout au nœud, sans moteur.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { murFaceA, murOppose, choisirMur, lierPieces, poserSansGene, salleDeTaille }
  from '../engine/src/editor/state/plan-regles.js';
import { RETRAIT_PORTAIL, ECART_PORTAILS } from '../engine/src/editor/state/portails-regles.js';
import { EPAISSEUR_MUR } from '../engine/src/core/charte-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle plan cliquable');

const A = { id: 'a', title: 'Salle A', shell: { width: 20, depth: 16 }, portals: [] };
const B = { id: 'b', title: 'Salle B', shell: { width: 12, depth: 12 }, portals: [] };

test('le mur qui fait face : l\'axe dominant décide, +x est l\'est, +z le sud', () => {
  assert.equal(murFaceA({ x: 0, z: 0 }, { x: 30, z: 4 }), 'est');
  assert.equal(murFaceA({ x: 0, z: 0 }, { x: -30, z: 4 }), 'ouest');
  assert.equal(murFaceA({ x: 0, z: 0 }, { x: 3, z: 30 }), 'sud');
  assert.equal(murFaceA({ x: 0, z: 0 }, { x: 3, z: -30 }), 'nord');
  assert.equal(murOppose('est'), 'ouest');
  assert.equal(murOppose('nord'), 'sud');
});

test('un trait vers l\'est : l\'aller sur le mur est de A, le retour sur le mur ouest de B, arrivées devant', () => {
  const lien = lierPieces(A, B, { murDepart: 'est' });
  assert.equal(lien.murDepart, 'est');
  assert.equal(lien.murCible, 'ouest');
  assert.equal(lien.aller.to, 'b');
  assert.equal(lien.aller.label, 'Salle B');
  assert.equal(lien.aller.rotationY, -90);
  assert.equal(lien.aller.position[0], 10 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL);
  assert.equal(lien.aller.position[2], 0);
  assert.equal(lien.retour.to, 'a');
  assert.equal(lien.retour.rotationY, 90);
  assert.ok(Math.abs(lien.retour.position[0] - -(6 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL)) < 1e-3);
  // l'aller débarque DANS B, devant le retour, tourné vers l'intérieur de B (vers +x)
  assert.ok(lien.aller.arrival[0] > lien.retour.position[0]);
  assert.equal(lien.aller.arrival[1], 2.2);
  // le retour débarque DANS A, devant l'aller (vers −x)
  assert.ok(lien.retour.arrival[0] < lien.aller.position[0]);
  assert.ok(lien.retour.regard[0] < lien.retour.arrival[0]);
});

test('un mur absent cède à son voisin ; sans coque, tout mur vaut', () => {
  const pavillon = { id: 'p', shell: { width: 20, depth: 20, walls: ['nord', 'est'] } };
  assert.equal(choisirMur(pavillon, 'sud'), 'est');
  assert.equal(choisirMur(pavillon, 'ouest'), 'nord');   // le voisin le plus naturel de l'ouest qu'il a
  assert.equal(choisirMur(pavillon, 'nord'), 'nord');
  assert.equal(choisirMur({ id: 'j', floor: { size: 64 } }, 'sud'), 'sud');
  assert.equal(choisirMur({ id: 'j' }, 'zut'), 'nord');
});

test('une pièce sans coque prend l\'empreinte du plan, pas son terrain', () => {
  const jardin = { id: 'j', title: 'Jardin', floor: { size: 64 }, portals: [] };
  const lien = lierPieces(A, jardin, { murDepart: 'sud', tailleCible: { w: 20, d: 30 } });
  assert.equal(lien.murCible, 'nord');
  assert.equal(lien.retour.position[2], -(15 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL));
  assert.equal(lien.retour.rotationY, 0);
  assert.deepEqual(salleDeTaille(jardin, { w: 20, d: 30 }).shell, { width: 20, depth: 30 });
  assert.equal(salleDeTaille(jardin, null), jardin);
});

test('un portail qui gêne décale la porte le long du mur', () => {
  const pose0 = poserSansGene('est', A, 0);
  const occupee = { ...A, portals: [{ to: 'x', position: pose0.position }] };
  const pose1 = poserSansGene('est', occupee, 0);
  assert.ok(Math.abs(pose1.position[2] - pose0.position[2]) >= ECART_PORTAILS);
  assert.equal(pose1.position[0], pose0.position[0]);
});

test('une pièce vers elle-même : rien (l\'Escher passe par le menu)', () => {
  assert.equal(lierPieces(A, A, { murDepart: 'est' }), null);
  assert.equal(lierPieces(A, null), null);
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
