/**
 * LE RETOUR D'UN PORTAIL, POSÉ SUR UN MUR (editor/state/portails-regles.js).
 *
 * « ＋ Portail vers… » posait le retour à trois mètres du point d'arrivée,
 * sans rotation, au milieu du sol. Il se pose désormais sur le mur de la
 * pièce visée le plus proche de son arrivée, tourné vers la salle, décalé
 * si un portail y gêne ; et les deux arrivées se déduisent des deux
 * portes — on débarque devant celle par laquelle on vient d'entrer.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { planPortail, poserSurMur, arriveeDevant, versInterieur, mursDe,
  RETRAIT_PORTAIL, AVANCE_ARRIVEE, PORTEE_REGARD, ECART_PORTAILS }
  from '../engine/src/editor/state/portails-regles.js';
import { EPAISSEUR_MUR } from '../engine/src/core/charte-regles.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };
const proche = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

console.log('\nle retour d\'un portail, posé sur un mur');

const depart = { id: 'entree', title: 'Entrée', shell: { width: 60, depth: 44 }, spawn: [0, 2.2, 8], portals: [] };
const salle = { id: 'phare', title: 'Phare', shell: { width: 26, depth: 20 }, spawn: [0, 2.2, 7], portals: [] };
// l'aller : posé sur le mur nord de l'entrée, tourné vers le sud (la salle)
const aller = { to: 'phare', position: [-7, 0, -13], rotationY: 0 };

test('vers l\'intérieur : l\'opposé de la sortie du plan', () => {
  assert.ok(proche([versInterieur(0).x, versInterieur(0).z], [0, 1]));       // mur nord : vers +z
  assert.ok(proche([versInterieur(180).x, versInterieur(180).z], [0, -1]));  // mur sud : vers −z
  assert.ok(proche([versInterieur(-90).x, versInterieur(-90).z], [-1, 0]));  // mur est : vers −x
  assert.ok(proche([versInterieur(90).x, versInterieur(90).z], [1, 0]));     // mur ouest : vers +x
});

test('poser sur un mur : à plat contre la face, en retrait, tourné vers la salle, borné le long du mur', () => {
  const sud = poserSurMur('sud', salle, 3);
  assert.equal(sud.rotationY, 180);
  assert.ok(proche(sud.position, [3, 0, 10 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL], 1e-3));
  const est = poserSurMur('est', salle, -40);   // bien au-delà du mur : ramené dans la pièce
  assert.equal(est.rotationY, -90);
  assert.ok(proche(est.position, [13 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL, 0, -(10 - 2)], 1e-3));
  assert.equal(poserSurMur('plafond', salle, 0), null);
});

test('l\'arrivée est devant la porte, le regard six mètres plus loin, à hauteur d\'yeux', () => {
  const a = arriveeDevant({ position: [0, 0, 9.225], rotationY: 180 });
  assert.ok(proche(a.arrival, [0, 2.2, 9.225 - AVANCE_ARRIVEE], 1e-3));
  assert.ok(proche(a.regard, [0, 2.0, 9.225 - AVANCE_ARRIVEE - PORTEE_REGARD], 1e-3));
});

test('le plan : retour sur le mur le plus proche de l\'arrivée de la cible, arrivées devant chaque porte', () => {
  const plan = planPortail(depart, salle, aller);
  const r = plan.retour;
  assert.equal(r.to, 'entree');
  assert.equal(r.label, 'Entrée');
  assert.equal(r.rotationY, 180);                       // le spawn (z = 7) est près du mur sud
  assert.ok(proche(r.position, [0, 0, 10 - EPAISSEUR_MUR / 2 - RETRAIT_PORTAIL], 1e-3));
  // en revenant, on débarque devant l'aller, dans l'entrée, le regard vers le sud
  assert.ok(proche(r.arrival, [-7, 2.2, -13 + AVANCE_ARRIVEE], 1e-3));
  assert.ok(proche(r.regard, [-7, 2.0, -13 + AVANCE_ARRIVEE + PORTEE_REGARD], 1e-3));
  // en entrant, on débarque devant le retour, dans le phare, le regard vers le nord
  assert.ok(proche(plan.arrival, [0, 2.2, r.position[2] - AVANCE_ARRIVEE], 1e-3));
  assert.ok(proche(plan.regard, [0, 2.0, r.position[2] - AVANCE_ARRIVEE - PORTEE_REGARD], 1e-3));
});

test('un portail déjà sur ce mur : le retour se décale de quatre mètres le long du mur', () => {
  const occupee = { ...salle, portals: [{ to: 'ailleurs', position: [0, 0, 9.2], rotationY: 180 }] };
  const plan = planPortail(depart, occupee, aller);
  assert.equal(plan.retour.rotationY, 180);
  assert.ok(Math.hypot(plan.retour.position[0] - 0, plan.retour.position[2] - 9.2) >= ECART_PORTAILS);
  assert.equal(plan.retour.position[0], 4);
});

test('une coque partielle : seuls ses murs comptent (le jardin n\'a que nord et ouest)', () => {
  const jardin = { id: 'jardin', shell: { width: 46, depth: 40, walls: ['nord', 'ouest'] }, spawn: [0, 2.2, 12], portals: [] };
  assert.deepEqual(mursDe(jardin), ['nord', 'ouest']);
  const plan = planPortail(depart, jardin, aller);
  // le spawn (z = 12) est près du sud, qui n'existe pas : parmi les murs réels, l'ouest (23 m) est plus proche que le nord (32 m)
  assert.equal(plan.retour.rotationY, 90);
  assert.ok(plan.retour.position[0] < 0);
});

test('sans coque (un extérieur, une pièce vide) : devant le point d\'arrivée, tourné vers lui, comme avant', () => {
  const dehors = { id: 'allee', title: 'Allée', floor: { size: 64 }, spawn: [0, 2.2, 11], portals: [] };
  assert.deepEqual(mursDe(dehors), []);
  const plan = planPortail(depart, dehors, aller);
  assert.deepEqual(plan.retour.position, [0, 0, 8]);
  assert.equal(plan.retour.rotationY, 0);
  assert.ok(proche(plan.arrival, [0, 2.2, 8 + AVANCE_ARRIVEE], 1e-3));
});

test('sans spawn : la règle prend le point d\'arrivée par défaut du moteur', () => {
  const nue = { id: 'nue', shell: { width: 26, depth: 20 }, portals: [] };
  const plan = planPortail(depart, nue, aller);
  assert.ok(plan.retour.position.every(Number.isFinite));
  assert.equal(plan.retour.rotationY, 180);   // [0, 2.2, 10] est au sud
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
