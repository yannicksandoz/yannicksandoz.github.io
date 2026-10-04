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
  deplacerPoint, COURBE_DEFAUT, BORNES_COURBE, loiSilhouette, loiSommet, loiPlafond, sommetModele, SOMMET_MIN } from '../engine/src/core/courbe-murs.js';

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
  assert.deepEqual(c.couronne, { forme: 'irreguliere', sens: 'bas', hauteur: BORNES_COURBE.couronne, ondes: 3 }, 'l’ancienne écriture : des vagues irrégulières qui descendent');
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

test('couronnement réglé (ancienne écriture) : zéro aux extrémités, il descend, la hauteur demandée', () => {
  const L = 30;
  const c = loiCouronneReglee({ length: L, couronne: { hauteur: 1.5, ondes: 4 } });
  assert.ok(proche(c(L / 2), 0) && proche(c(-L / 2), 0));
  let max = 0, min = Infinity;
  for (let i = 0; i <= 300; i++) { const v = c(-L / 2 + (i / 300) * L); max = Math.max(max, v); min = Math.min(min, v); }
  assert.ok(proche(max, 1.5, 0.02), `creux maximal ${max}`);
  assert.ok(min >= 0, 'le sommet ne monte jamais au-dessus du nominal');
  assert.equal(loiCouronneReglee({ length: L, couronne: null })(0), 0);
});

test('la silhouette : trois formes, vers le haut ou le bas, zéro aux angles', () => {
  const L = 24;
  const maxi = (f) => { let a = -Infinity, b = Infinity; for (let i = 0; i <= 480; i++) { const v = f(-L / 2 + (i / 480) * L); a = Math.max(a, v); b = Math.min(b, v); } return [a, b]; };
  for (const forme of ['arche', 'vagues', 'irreguliere']) {
    const haut = loiSilhouette({ length: L, couronne: { forme, sens: 'haut', hauteur: 2, ondes: 3 } });
    const bas = loiSilhouette({ length: L, couronne: { forme, sens: 'bas', hauteur: 2, ondes: 3 } });
    assert.ok(proche(haut(-L / 2), 0) && proche(haut(L / 2), 0, 1e-6), `${forme} : les angles restent à la hauteur`);
    const [hMax, hMin] = maxi(haut);
    assert.ok(proche(hMax, 2, 0.03) && hMin >= -1e-9, `${forme} vers le haut : jusqu’à +2 (${hMax.toFixed(2)}), jamais dessous`);
    const [bMax, bMin] = maxi(bas);
    assert.ok(proche(bMin, -2, 0.03) && bMax <= 1e-9, `${forme} vers le bas : jusqu’à −2`);
  }
  // des arches : elles se touchent en pointe entre deux (zéro au tiers et aux deux tiers)
  const arches = loiSilhouette({ length: L, couronne: { forme: 'arche', sens: 'haut', hauteur: 2, ondes: 3 } });
  assert.ok(proche(arches(-L / 2 + L / 3), 0, 1e-6) && proche(arches(-L / 2 + L / 6), 2, 1e-6));
  // dessinée à la main : l’ancre est sur la silhouette
  const libre = loiSilhouette({ length: L, couronne: { points: [{ t: 0.5, d: 3 }] } });
  assert.ok(proche(libre(0), 3, 0.05));
  // le couronnement du moteur est l’opposé (de combien le sommet DESCEND)
  assert.ok(proche(loiCouronneReglee({ length: L, couronne: { forme: 'vagues', sens: 'haut', hauteur: 1, ondes: 1 } })(0), -1, 1e-6));
});

test('le haut d’un mur : la droite entre ses angles, la silhouette, jamais trop bas', () => {
  const c = normaliserCourbe({ profondeur: 0, couronne: { forme: 'vagues', sens: 'haut', hauteur: 1, ondes: 1 }, angles: { no: 0, ne: 4, se: -2, so: 0 } });
  const L = 20;
  const nord = loiSommet({ length: L, height: 6, mur: 'nord', reglage: courbeDuMur(c, 'nord'), angles: c.angles });
  assert.ok(proche(nord(-10), 0) && proche(nord(10), 4) && proche(nord(0), 2 + 1), `nord : no 0 → ne 4, +1 au milieu (${nord(0)})`);
  const est = loiSommet({ length: L, height: 6, mur: 'est', reglage: courbeDuMur(c, 'est'), angles: c.angles });
  assert.ok(proche(est(-10), -2) && proche(est(10), 4), 'est : de se (t=0) à ne (t=1) — un angle partagé par deux murs');
  const bas = loiSommet({ length: L, height: 3, mur: 'sud', reglage: { couronne: { forme: 'vagues', sens: 'bas', hauteur: 8, ondes: 1 } } });
  assert.ok(proche(3 + bas(0), SOMMET_MIN), 'le haut ne descend pas sous SOMMET_MIN');
  const baie = loiSommet({ length: L, height: 6, mur: 'sud', reglage: { couronne: { forme: 'vagues', sens: 'bas', hauteur: 4, ondes: 1 } }, plancher: (x) => (Math.abs(x) < 2 ? 4.5 : 0) });
  assert.ok(6 + baie(0) >= 4.5 - 1e-9, 'ni sous le linteau d’une baie');
  assert.equal(sommetModele(c, 'nord'), true);
  assert.equal(sommetModele({ profondeur: 1 }, 'nord'), false);
  // une silhouette de mur complète celle de l’espace ; null l’éteint pour ce mur
  const m = normaliserCourbe({ couronne: { forme: 'arche', sens: 'haut', hauteur: 2 }, murs: { est: { couronne: { hauteur: 3 } }, ouest: { couronne: false } } });
  assert.deepEqual(courbeDuMur(m, 'est').couronne, { forme: 'arche', sens: 'haut', hauteur: 3, ondes: 3 });
  assert.equal(courbeDuMur(m, 'ouest').couronne, null);
  assert.equal(normaliserCourbe({ couronne: { points: [{ t: 0.5, d: 1 }] } }).couronne.points, undefined, 'à main levée : mur par mur seulement');
});

test('le plafond suit : le haut de chaque mur sur son bord, la voûte au milieu', () => {
  const c = { profondeur: 0, couronne: { forme: 'arche', sens: 'haut', hauteur: 1.5, ondes: 1 }, angles: { ne: 3 }, voute: 2 };
  const dims = { width: 20, depth: 16, height: 6, epaisseur: 0 };
  const p = loiPlafond(c, dims);
  const sommet = (mur, x) => loiSommet({ length: mur === 'nord' || mur === 'sud' ? 20 : 16, height: 6, mur, reglage: courbeDuMur(c, mur), angles: normaliserCourbe(c).angles })(x);
  for (const x of [-8, -3, 0, 5, 9]) assert.ok(proche(p(x, -8), sommet('nord', x), 1e-6), `bord nord en x=${x}`);
  for (const z of [-6, 0, 4]) assert.ok(proche(p(10, z), sommet('est', -z), 1e-6), `bord est en z=${z}`);
  assert.ok(proche(p(10, -8), 3, 1e-6), 'l’angle nord-est à +3');
  const sansVoute = loiPlafond({ ...c, voute: 0 }, dims);
  assert.ok(proche(p(0, 0) - sansVoute(0, 0), 2, 1e-6), 'la voûte : +2 au centre');
  assert.ok(proche(p(14, 0), p(10, 0), 1e-9), 'hors du rectangle : le bord le plus proche');
  assert.equal(loiPlafond(null, dims)(0, 0), 0);
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
