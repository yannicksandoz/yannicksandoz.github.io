/**
 * LES LIGNES DE LUMIÈRE, ÉPROUVÉES.
 *
 * Une forme close vaut ce que vaut sa preuve. Celle-ci est confrontée à
 * une intégration numérique brutale — le seul juge qui ne partage pas ses
 * hypothèses — sur des centaines de configurations tirées au hasard, cas
 * limites compris : segment quasi ponctuel, surface presque dans le plan
 * de la ligne, segment à moitié derrière l'horizon.
 *
 * On vérifie aussi ce qui a MOTIVÉ tout cela : qu'un point unique de même
 * puissance ne rend pas le même éclairement, et de loin.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { irradianceLigne, MAX_LIGNES, reinitialiserLignes, ajouterLigne,
  nombreDeLignes, patcherLignes, activerLignes, lignesActives }
  from '../engine/src/core/lignes-lumiere.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const pt = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norme = (u) => Math.hypot(u[0], u[1], u[2]);
const unite = (u) => { const l = norme(u) || 1; return [u[0] / l, u[1] / l, u[2] / l]; };

/** Le juge : on découpe le segment et l'on somme, horizon compris. */
function numerique(P, N, A, B, pas = 120000) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = norme(d);
  const dh = unite(d);
  const ds = L / pas;
  let E = 0;
  for (let i = 0; i < pas; i++) {
    const s = (i + 0.5) * ds;
    const x = [A[0] + dh[0] * s - P[0], A[1] + dh[1] * s - P[1], A[2] + dh[2] * s - P[2]];
    const r = norme(x);
    E += Math.max(0, pt(N, unite(x))) / (r * r) * ds;
  }
  return E;
}

// tirage reproductible : un test qui change de cas à chaque exécution
// ne dit rien de stable le jour où il rougit
const tirage = (() => {
  let s = 987654321;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
})();

titre('la forme close contre l’intégration numérique');
test('mille configurations, erreur relative sous 10⁻⁴', () => {
  let pire = 0, pireCas = null, comptees = 0;
  for (let i = 0; i < 1000; i++) {
    const P = [(tirage() - 0.5) * 30, tirage() * 4, (tirage() - 0.5) * 30];
    const A = [(tirage() - 0.5) * 40, 2 + tirage() * 8, (tirage() - 0.5) * 40];
    const B = i % 7 === 0
      // segment quasi ponctuel : le cas où h² et L tendent vers zéro
      ? [A[0] + (tirage() - 0.5) * 0.02, A[1], A[2] + (tirage() - 0.5) * 0.02]
      : [(tirage() - 0.5) * 40, A[1] + (tirage() - 0.5) * 4, (tirage() - 0.5) * 40];
    const N = unite([(tirage() - 0.5) * 2, tirage() * 1.2 - 0.1, (tirage() - 0.5) * 2]);
    const ref = numerique(P, N, A, B);
    if (ref < 1e-6) continue;                 // rien à comparer
    comptees++;
    const err = Math.abs(irradianceLigne(P, N, A, B) - ref) / ref;
    if (err > pire) { pire = err; pireCas = { P, N, A, B, ref }; }
  }
  assert.ok(comptees > 500, `${comptees} configurations retenues seulement`);
  assert.ok(pire < 1e-4,
    `erreur ${(pire * 100).toFixed(4)} % — ${JSON.stringify(pireCas)}`);
});
test('le cas d’école : un bandeau au-dessus d’un sol', () => {
  const P = [0, 0, 0], N = [0, 1, 0];
  const A = [-20, 6, -10], B = [20, 6, -10];
  const close = irradianceLigne(P, N, A, B);
  assert.ok(Math.abs(close - numerique(P, N, A, B)) / close < 1e-5);
  assert.ok(close > 0, 'un bandeau au-dessus éclaire');
});

titre('l’horizon');
test('un segment entièrement derrière la surface ne donne rien', () => {
  assert.equal(irradianceLigne([0, 0, 0], [0, 1, 0], [-5, -3, 2], [5, -3, 2]), 0);
});
test('un segment à cheval sur l’horizon est coupé, pas rejeté', () => {
  const P = [0, 0, 0], N = [0, 1, 0];
  const A = [-6, -2, 3], B = [6, 4, 3];       // il traverse le plan y = 0
  const close = irradianceLigne(P, N, A, B);
  const ref = numerique(P, N, A, B);
  assert.ok(close > 0, 'la moitié éclairante compte');
  assert.ok(Math.abs(close - ref) / ref < 1e-4,
    `coupe fautive : ${close.toFixed(6)} contre ${ref.toFixed(6)}`);
});
test('la coupe marche dans les deux sens', () => {
  // la même géométrie, extrémités échangées : la loi doit être symétrique
  const P = [0, 0, 0], N = [0, 1, 0];
  const A = [-6, -2, 3], B = [6, 4, 3];
  assert.ok(Math.abs(irradianceLigne(P, N, A, B) - irradianceLigne(P, N, B, A))
    / irradianceLigne(P, N, A, B) < 1e-9);
});

titre('pourquoi une ligne, et pas un point');
test('un point unique de même puissance se trompe du simple au double', () => {
  // C'EST la faute que le profil mobile commettait : un cône au milieu du
  // bandeau. On compare l'éclairement au pied du centre du mur.
  const P = [0, 0, 0], N = [0, 1, 0];
  const A = [-20, 6, -10], B = [20, 6, -10];
  const ligne = irradianceLigne(P, N, A, B);
  const L = norme([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  const milieu = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  const r = norme(milieu);
  const point = Math.max(0, pt(N, unite(milieu))) / (r * r) * L;
  assert.ok(point / ligne > 1.8,
    `le point ne surexpose que ×${(point / ligne).toFixed(2)} au centre`);
});
test('…et laisse le bout du mur dans le noir', () => {
  // au pied d'une EXTRÉMITÉ du bandeau, la ligne éclaire encore beaucoup ;
  // le point, lui, est à vingt mètres
  const N = [0, 1, 0];
  const A = [-20, 6, -10], B = [20, 6, -10];
  const bout = [-19, 0, 0];
  const ligne = irradianceLigne(bout, N, A, B);
  const centre = irradianceLigne([0, 0, 0], N, A, B);
  assert.ok(ligne / centre > 0.35,
    `la ligne s'effondre au bout (${(ligne / centre).toFixed(2)} du centre)`);
});

titre('le registre');
test('une salle oubliée est vraiment oubliée', () => {
  reinitialiserLignes();
  const faux = { updateWorldMatrix() {}, matrixWorld: null };
  ajouterLigne({ objet: faux, a: [0, 0, 0], b: [1, 0, 0], couleur: '#fff' });
  assert.equal(nombreDeLignes(), 1);
  reinitialiserLignes();
  assert.equal(nombreDeLignes(), 0);
});
test('une déclaration incomplète est refusée sans bruit', () => {
  reinitialiserLignes();
  assert.equal(ajouterLigne({ a: [0, 0, 0], b: [1, 0, 0] }), null);
  assert.equal(nombreDeLignes(), 0);
});
test('le budget de segments reste tenable pour un téléphone', () => {
  // huit segments à une quinzaine d'opérations : le prix d'un point, pas
  // celui d'une LTC. Si quelqu'un le monte, qu'il le mesure d'abord.
  assert.ok(MAX_LIGNES <= 8, `${MAX_LIGNES} segments : mesurez avant`);
});

titre('la greffe sur les matériaux');
test('sans profil sans sources étendues, on ne greffe RIEN', () => {
  // le bureau garde ses RectAreaLight et ses programmes : la greffe
  // recompilerait tous ses shaders pour une boucle qui sort au premier tour
  activerLignes(false);
  const mur = { isMeshStandardMaterial: true, userData: {} };
  patcherLignes(mur);
  assert.ok(!mur.onBeforeCompile, 'aucune greffe hors profil mobile');
  assert.equal(lignesActives(), false);
  activerLignes(true);        // le reste des tests parle du profil mobile
});
test('seuls les matériaux qui s’éclairent sont corrigés', () => {
  const emissif = { isMeshBasicMaterial: true, userData: {} };
  patcherLignes(emissif);
  assert.ok(!emissif.onBeforeCompile, 'un bandeau émissif ne reçoit rien');
  const mur = { isMeshStandardMaterial: true, userData: {} };
  patcherLignes(mur);
  assert.equal(typeof mur.onBeforeCompile, 'function');
});
test('la greffe est idempotente et n’écrase pas ce qui existe', () => {
  let appels = 0;
  const mat = {
    isMeshStandardMaterial: true, userData: {},
    onBeforeCompile: () => { appels++; }
  };
  patcherLignes(mat);
  const apres = mat.onBeforeCompile;
  patcherLignes(mat);
  assert.equal(mat.onBeforeCompile, apres, 'la deuxième greffe ne fait rien');
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <lights_fragment_begin>' };
  mat.onBeforeCompile(shader, null);
  assert.equal(appels, 1, 'le onBeforeCompile précédent est appelé');
  assert.ok(shader.fragmentShader.includes('lignesIrradiance'), 'le code est injecté');
  assert.ok(shader.uniforms.uLigneNombre, 'les uniformes sont branchés');
});
test('les uniformes sont PARTAGÉS entre matériaux', () => {
  // sinon il faudrait parcourir tous les matériaux à chaque image
  const f = () => {
    const m = { isMeshStandardMaterial: true, userData: {} };
    patcherLignes(m);
    const s = { uniforms: {}, fragmentShader: '#include <common>\n#include <lights_fragment_begin>' };
    m.onBeforeCompile(s, null);
    return s.uniforms.uLigneNombre;
  };
  assert.equal(f(), f(), 'deux matériaux doivent viser le même objet');
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
if (ko) process.exitCode = 1;
