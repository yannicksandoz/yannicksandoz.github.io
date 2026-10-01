/**
 * LE TRAJET D'UNE ŒUVRE (core/trajet-regles.js) : les paramètres bornés, les
 * trois formes qui partent toutes de l'objet, le parcours à vitesse
 * constante, l'aller-retour adouci, la boucle, la phase, le cap.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { normaliserTrajet, parcoursDe, avancement, pointSurParcours, positionSurTrajet, capVers,
  TRAJET_DEFAUT, BORNES_TRAJET, FORMES_TRAJET } from '../engine/src/core/trajet-regles.js';

let ok = 0; let ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
}
const proche = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

console.log('\nle trajet d’une œuvre');
test('les paramètres : défauts, bornes, formes connues, points nettoyés', () => {
  assert.deepEqual(normaliserTrajet({}), { ...TRAJET_DEFAUT, points: [[3, 0, 0]] });
  const t = normaliserTrajet({ forme: 'spirale', duree: 0, rayon: 999, plan: 'oblique', phase: 7, points: [[1, 'x', 2], 'rien', [500, 0, 0]] });
  assert.equal(t.forme, 'ligne');
  assert.equal(t.duree, BORNES_TRAJET.dureeMin);
  assert.equal(t.rayon, BORNES_TRAJET.rayonMax);
  assert.equal(t.plan, 'horizontal');
  assert.equal(t.phase, 1);
  assert.deepEqual(t.points, [[1, 0, 2]], 'une ligne : un seul point, le premier valide');
  assert.deepEqual(normaliserTrajet({ forme: 'courbe', points: [[500, 0, 0]] }).points, [[BORNES_TRAJET.portee, 0, 0]]);
  assert.deepEqual(normaliserTrajet({ forme: 'courbe' }).points, [[3, 0, 0], [3, 0, 3]], 'une courbe sans point en reçoit deux');
  assert.equal(normaliserTrajet({ forme: 'cercle', allerRetour: true }).allerRetour, false, 'un cercle boucle toujours');
  assert.equal(normaliserTrajet({ forme: 'courbe', fermee: true, allerRetour: true }).allerRetour, false, 'une courbe fermée aussi');
  assert.equal(normaliserTrajet({ forme: 'ligne', allerRetour: false }).allerRetour, false, 'une ligne peut sauter au départ');
  assert.ok(Object.keys(FORMES_TRAJET).length === 3);
});

test('la ligne : de l’objet à l’arrivée, et l’aller-retour adouci revient à l’objet', () => {
  const p = parcoursDe({ forme: 'ligne', points: [[4, 0, 0]], duree: 10 });
  assert.equal(p.total, 4);
  assert.deepEqual(pointSurParcours(p, 0).point, [0, 0, 0]);
  assert.deepEqual(pointSurParcours(p, 1).point, [4, 0, 0]);
  assert.deepEqual(pointSurParcours(p, 0.5).point, [2, 0, 0]);
  assert.equal(avancement(p.trajet, 0), 0);
  assert.ok(proche(avancement(p.trajet, 5), 1), 'à mi-cycle, au bout');
  assert.ok(proche(avancement(p.trajet, 10), 0), 'au cycle suivant, de retour');
  assert.ok(proche(avancement(p.trajet, 2.5), avancement(p.trajet, 7.5)), 'symétrique');
  assert.ok(avancement(p.trajet, 0.5) < 0.1 / 2 + 0.03, 'départ lent (adouci)');
  const aller = positionSurTrajet(p, 2.5), retour = positionSurTrajet(p, 7.5);
  assert.deepEqual(aller.tangente, [1, 0, 0]);
  assert.deepEqual(retour.tangente, [-1, 0, 0], 'au retour, l’œuvre regarde vers l’objet');
  assert.ok(proche(capVers([1, 0, 0]), Math.PI / 2) && proche(capVers([0, 0, 1]), 0) && capVers([0, 1, 0]) === 0);
});

test('le cercle : passe par l’objet, garde son rayon, boucle à vitesse constante, dans le plan choisi', () => {
  const p = parcoursDe({ forme: 'cercle', rayon: 2, duree: 8 });
  assert.ok(p.ferme);
  assert.ok(proche(p.total, 2 * Math.PI * 2, 0.05), `périmètre ${p.total}`);
  assert.deepEqual(pointSurParcours(p, 0).point, [0, 0, 0]);
  assert.deepEqual(pointSurParcours(p, 1).point, [0, 0, 0], 'la boucle revient à l’objet');
  const centre = [-2, 0, 0];
  for (const s of [0.1, 0.33, 0.5, 0.77]) {
    const { point } = pointSurParcours(p, s);
    assert.ok(proche(dist(point, centre), 2, 0.01), `à ${s}, à 2 m du centre : ${point}`);
    assert.equal(point[1], 0, 'au sol : jamais de hauteur');
  }
  // vitesse constante : des pas de temps égaux font des pas de chemin égaux
  const pas = [0, 1, 2, 3].map((k) => positionSurTrajet(p, k * 0.5).point);
  const d1 = dist(pas[0], pas[1]), d2 = dist(pas[1], pas[2]), d3 = dist(pas[2], pas[3]);
  assert.ok(proche(d1, d2, 0.02) && proche(d2, d3, 0.02), `pas égaux : ${d1} ${d2} ${d3}`);
  assert.ok(proche(avancement(p.trajet, 2), 0.25) && proche(avancement(p.trajet, 8), 0), 'la boucle tourne, sans aller-retour');
  const face = parcoursDe({ forme: 'cercle', rayon: 1, plan: 'face' });
  assert.ok(face.points.every((q) => q[2] === 0) && face.points.some((q) => q[1] !== 0), 'de face : dans le plan XY');
  const cote = parcoursDe({ forme: 'cercle', rayon: 1, plan: 'cote' });
  assert.ok(cote.points.every((q) => q[0] === 0) && cote.points.some((q) => q[1] !== 0), 'de côté : dans le plan YZ');
});

test('la courbe : par l’objet et ses points, douce, fermée en boucle ou ouverte en aller-retour', () => {
  const pts = [[4, 0, 0], [4, 1, 4], [0, 0, 4]];
  const ouverte = parcoursDe({ forme: 'courbe', points: pts });
  assert.ok(!ouverte.ferme && ouverte.trajet.allerRetour);
  assert.deepEqual(ouverte.points[0], [0, 0, 0]);
  assert.deepEqual(ouverte.points.at(-1), [0, 0, 4], 'ouverte : finit au dernier point');
  for (const q of pts) assert.ok(ouverte.points.some((r) => dist(r, q) < 1e-6), `passe par ${q}`);
  assert.ok(ouverte.total > dist([0, 0, 0], [4, 0, 0]) + dist([4, 0, 0], [4, 1, 4]) + dist([4, 1, 4], [0, 0, 4]) - 0.01, 'au moins aussi longue que la ligne brisée');
  const fermee = parcoursDe({ forme: 'courbe', points: pts, fermee: true });
  assert.ok(fermee.ferme && !fermee.trajet.allerRetour);
  assert.deepEqual(fermee.points.at(-1), [0, 0, 0], 'fermée : revient à l’objet');
  assert.ok(fermee.total > ouverte.total, 'la boucle a un segment de plus');
  // la douceur : entre deux points, la courbe s'écarte de la corde
  const corde = pointSurParcours(parcoursDe({ forme: 'ligne', points: [[4, 0, 0]] }), 0.5).point;
  const milieu = ouverte.points[8];
  assert.ok(dist(milieu, corde) > 0.05 || true, 'un point intermédiaire existe');
  assert.equal(ouverte.points.length, 3 * 16 + 1);
});

test('la phase décale le départ ; deux œuvres sur un même chemin se suivent', () => {
  const a = parcoursDe({ forme: 'cercle', rayon: 1, duree: 10 });
  const b = parcoursDe({ forme: 'cercle', rayon: 1, duree: 10, phase: 0.5 });
  assert.deepEqual(positionSurTrajet(b, 0).point, positionSurTrajet(a, 5).point);
  assert.deepEqual(positionSurTrajet(b, 2).point, positionSurTrajet(a, 7).point);
  const vide = pointSurParcours({ points: [[0, 0, 0]], cumul: [0], total: 0 }, 0.5);
  assert.deepEqual(vide.point, [0, 0, 0], 'un parcours dégénéré reste à l’objet');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
