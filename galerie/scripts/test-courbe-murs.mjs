/**
 * LA COURBE DES MURS (core/courbe-murs.js) : réglages bornés, mur par mur,
 * loi paramétrique (profondeur, ondes, sens, profil), courbe vectorielle
 * (ancres et poignées, extrémités à zéro, t toujours croissant),
 * couronnement réglé, débord pour le sol, et le passage mur ↔ plan que
 * les poignées de l'éditeur utilisent.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { normaliserCourbe, courbeDuMur, normaliserPoints, profilVectoriel, loiVoileReglee,
  loiCouronneReglee, debordExterieur, debordCoque, geometrieMur, ajouterAncre, retirerAncre,
  deplacerPoint, COURBE_DEFAUT, BORNES_COURBE } from '../engine/src/core/courbe-murs.js';

let ok = 0; let ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
}
const proche = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

console.log('\nla courbe des murs');
test('les réglages : absent = rien ; défauts ; bornes ; mur par mur partiel', () => {
  assert.equal(normaliserCourbe(undefined), null);
  assert.equal(normaliserCourbe(false), null);
  assert.deepEqual(normaliserCourbe({}), { ...COURBE_DEFAUT });
  const c = normaliserCourbe({ profondeur: 99, ondes: 0, sens: 'bombe', profil: 'voile', couronne: { hauteur: 9, ondes: 2.6 },
    murs: { nord: { profondeur: 2 }, sud: { foo: 1 }, ouest: 'x' } });
  assert.equal(c.profondeur, BORNES_COURBE.profondeur);
  assert.equal(c.ondes, 1);
  assert.equal(c.sens, 'bombe');
  assert.equal(c.profil, 'voile');
  assert.deepEqual(c.couronne, { hauteur: BORNES_COURBE.couronne, ondes: 3 });
  assert.deepEqual(c.murs, { nord: { profondeur: 2 } }, 'un mur ne garde que ce qu’il écrit');
  const nord = courbeDuMur(c, 'nord');
  assert.equal(nord.profondeur, 2);
  assert.equal(nord.sens, 'bombe', 'le reste vient de l’espace');
  assert.equal(courbeDuMur(c, 'est').profondeur, BORNES_COURBE.profondeur);
  assert.equal(courbeDuMur(null, 'nord'), null);
});

test('paramétrique : extrémités à zéro, une bosse au milieu, n bosses alternées, sens', () => {
  const L = 20, H = 5;
  const loi = loiVoileReglee({ length: L, height: H, reglage: courbeDuMur({ profondeur: 1 }, 'nord') });
  assert.ok(proche(loi(-L / 2, 2), 0) && proche(loi(L / 2, 2), 0), 'les angles restent jointifs');
  assert.ok(proche(loi(0, 2), 1), 'au milieu, toute la profondeur, vers l’extérieur');
  assert.ok(proche(loi(0, 0), 1), 'profil droit : le pied suit aussi');
  const bombe = loiVoileReglee({ length: L, height: H, reglage: courbeDuMur({ profondeur: 1, sens: 'bombe' }, 'nord') });
  assert.ok(proche(bombe(0, 2), -1), 'bombé : vers l’intérieur');
  const deux = loiVoileReglee({ length: L, height: H, reglage: courbeDuMur({ profondeur: 1, ondes: 2 }, 'nord') });
  assert.ok(deux(-L / 4, 2) > 0.99 && deux(L / 4, 2) < -0.99, 'deux ondes : une bosse dehors, une dedans');
  const voile = loiVoileReglee({ length: L, height: H, reglage: courbeDuMur({ profondeur: 1, profil: 'voile' }, 'nord') });
  assert.ok(proche(voile(0, 0), 0) && proche(voile(0, H), 1), 'voile : pied droit, sommet cintré');
  const avecBaie = loiVoileReglee({ length: L, height: H, zones: [[-2, 2]], reglage: courbeDuMur({ profondeur: 1 }, 'nord') });
  assert.equal(avecBaie(0, 2), 0, 'une baie reste plane');
});

test('vectorielle : ancres triées, poignées bornées (t croissant), extrémités à zéro, passe par les ancres', () => {
  const pts = normaliserPoints([{ t: 0.7, d: -0.5 }, { t: 0.3, d: 1.2, apres: [0.9, 2] }, { t: 0.3001, d: 4 }, 'x']);
  assert.equal(pts.length, 2, 'triées, la quasi-jumelle cède, le reste filtré');
  assert.equal(pts[0].t, 0.3);
  assert.ok(pts[0].apres[0] <= 0.7 - 0.3 + 1e-9, 'la poignée ne dépasse pas l’ancre suivante');
  assert.ok(pts[0].avant[0] <= 0 && pts[0].avant[0] >= -0.3, 'la poignée avant reste avant');
  const profil = profilVectoriel(pts);
  assert.deepEqual(profil[0], [0, 0]);
  assert.deepEqual(profil.at(-1).map((v) => Math.round(v * 1000) / 1000), [1, 0]);
  for (let i = 1; i < profil.length; i++) assert.ok(profil[i][0] >= profil[i - 1][0], 't croissant');
  const loi = loiVoileReglee({ length: 10, height: 4, reglage: { points: pts } });
  assert.ok(proche(loi(-5 + 0.3 * 10, 2), 1.2, 0.02), `passe par l’ancre (${loi(-2, 2)})`);
  assert.ok(proche(loi(-5 + 0.7 * 10, 2), -0.5, 0.02), 'et par la seconde, vers l’intérieur');
  assert.ok(proche(loi(-5, 2), 0) && proche(loi(5, 2), 0));
});

test('éditer la courbe libre : ajouter sur la courbe, déplacer, poignée en miroir ou cassée, retirer', () => {
  let r = { points: normaliserPoints([{ t: 0.5, d: 1 }]) };
  const pts = ajouterAncre(r, 0.25, { longueur: 10, height: 4 });
  assert.equal(pts.length, 2);
  const loiAvant = loiVoileReglee({ length: 10, height: 4, reglage: r });
  assert.ok(proche(pts[0].d, loiAvant(-2.5, 4), 1e-3), 'la nouvelle ancre naît SUR la courbe : rien ne saute');
  r = { points: pts };
  const bouge = deplacerPoint(r.points, 1, 'ancre', 0.1, 2);
  assert.ok(bouge[1].t > bouge[0].t, 'une ancre ne passe pas sa voisine');
  const lisse = deplacerPoint(r.points, 1, 'apres', 0.5 + 0.1, 1 + 0.3);
  const a = lisse[1];
  const croix = a.apres[0] * a.avant[1] - a.apres[1] * a.avant[0];
  assert.ok(Math.abs(croix) < 1e-3 && (a.apres[0] * a.avant[0] + a.apres[1] * a.avant[1]) < 0, 'tangente lisse : poignées alignées, opposées');
  // sur un mur de 40 m, la jumelle garde sa longueur EN MÈTRES (pas en unités mêlées t et d)
  const avantM = Math.hypot(r.points[1].avant[0] * 40, r.points[1].avant[1]);
  const long = deplacerPoint(r.points, 1, 'apres', 0.5 + 0.01, 1 + 3, { longueur: 40 })[1];
  assert.ok(proche(Math.hypot(long.avant[0] * 40, long.avant[1]), avantM, 0.02), `jumelle : ${avantM.toFixed(2)} m gardés`);
  assert.ok(Math.abs(long.apres[0] * 40 * long.avant[1] - long.apres[1] * long.avant[0] * 40) < 1e-2, 'et alignée sur le plan');
  const casse = deplacerPoint(r.points, 1, 'apres', 0.6, 1.3, { casse: true });
  assert.deepEqual(casse[1].avant, r.points[1].avant, 'Alt : la jumelle ne bouge pas');
  assert.equal(retirerAncre(r.points, 0).length, 1);
});

test('couronnement réglé : zéro aux extrémités, jamais au-dessus du sommet, la hauteur demandée', () => {
  const L = 30;
  const c = loiCouronneReglee({ length: L, couronne: { hauteur: 1.5, ondes: 4 } });
  assert.ok(proche(c(L / 2), 0) && proche(c(-L / 2), 0));
  let max = 0, min = Infinity;
  for (let i = 0; i <= 300; i++) { const v = c(-L / 2 + (i / 300) * L); max = Math.max(max, v); min = Math.min(min, v); }
  assert.ok(proche(max, 1.5, 0.02), `creux maximal ${max}`);
  assert.ok(min >= 0, 'le sommet ne monte jamais au-dessus du nominal');
  assert.equal(loiCouronneReglee({ length: L, couronne: null })(0), 0);
});

test('débord vers l’extérieur : pour le sol et le plafond', () => {
  assert.equal(debordExterieur(courbeDuMur({ profondeur: 1.5 }, 'nord')), 1.5);
  assert.equal(debordExterieur(courbeDuMur({ profondeur: 1.5, sens: 'bombe' }, 'nord')), 0);
  assert.equal(debordExterieur(courbeDuMur({ profondeur: 1.5, sens: 'bombe', ondes: 2 }, 'nord')), 1.5);
  assert.equal(debordCoque({ profondeur: 0.5, murs: { est: { points: [{ t: 0.5, d: 2.5 }] } } }), 2.5);
  assert.equal(debordCoque(null), 0);
});

test('le mur dans le plan de l’espace : aller et retour, les quatre murs, d vers l’extérieur', () => {
  const dims = { width: 20, depth: 10, epaisseur: 0.3 };
  for (const mur of ['nord', 'sud', 'est', 'ouest']) {
    const g = geometrieMur(mur, dims);
    const [x, z] = g.versPlan(0.25, 1.5);
    const [t, d] = g.depuisPlan(x, z);
    assert.ok(proche(t, 0.25) && proche(d, 1.5), `${mur} : aller-retour (${t}, ${d})`);
    const [x0, z0] = g.versPlan(0.5, 0);
    const [x1, z1] = g.versPlan(0.5, 1);
    assert.ok(Math.hypot(x1, z1) > Math.hypot(x0, z0), `${mur} : d positif s’éloigne du centre`);
  }
  assert.equal(geometrieMur('nord', dims).longueur, 20.3);
  assert.equal(geometrieMur('est', dims).longueur, 9.7);
  assert.deepEqual(geometrieMur('nord', dims).versPlan(0, 0), [-10.15, -5]);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
