/**
 * LE CARTOUCHE DE MESURE (ui/Perf.js) : la statistique glissante, les
 * nombres lisibles, les crans en mots, et le paramètre d'adresse.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { Statistiques, compact, texteCrans, perfDemande } from '../engine/src/ui/Perf.js';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle cartouche de mesure');

test('sans mesure, tout vaut zéro', () => {
  const s = new Statistiques();
  assert.equal(s.moyenne(), 0);
  assert.equal(s.p95(), 0);
  assert.equal(s.n, 0);
});

test('la moyenne et le p95 d\'images régulières puis d\'un à-coup', () => {
  const s = new Statistiques();
  let t = 0;
  for (let i = 0; i < 100; i++) { t += 1 / 60; s.ajouter(t, 1 / 60); }
  assert.equal((s.moyenne() * 1000).toFixed(1), '16.7');
  assert.equal((s.p95() * 1000).toFixed(1), '16.7');
  // six images à 50 ms sur cent six (plus de 5 %) : le p95 les voit, la moyenne à peine
  for (let i = 0; i < 6; i++) { t += 0.05; s.ajouter(t, 0.05); }
  assert.ok(s.p95() >= 0.049, `p95 ${s.p95()}`);
  assert.ok(s.moyenne() < 0.02, `moyenne ${s.moyenne()}`);
});

test('la fenêtre glisse : ce qui a plus de deux secondes s\'oublie', () => {
  const s = new Statistiques({ fenetre: 2 });
  s.ajouter(0, 0.1);
  for (let t = 0.1; t <= 3.0001; t += 0.1) s.ajouter(t, 0.01);
  assert.ok(s.n <= 21 && s.n >= 19, `n ${s.n}`);
  assert.equal(s.p95(), 0.01);
  // une durée nulle ou négative ne compte pas
  s.ajouter(3.1, 0); s.ajouter(3.2, -1);
  assert.equal(s.n, 20);
});

test('les nombres se lisent : 312, 4,1 k, 410 k, 1,2 M', () => {
  assert.equal(compact(312), '312');
  assert.equal(compact(4100), '4.1 k');
  assert.equal(compact(410000), '410 k');
  assert.equal(compact(1234567), '1.2 M');
  assert.equal(compact(NaN), '—');
});

test('les crans en mots : ce qui est coupé se voit', () => {
  const t = texteCrans({ msaa: 0, gtao: false, ombres: false, isf: 256, etendues: 0, apparitions: true, pixelRatio: 1.25, grain: true, bloom: true });
  assert.equal(t, 'msaa 0 · gtao·off · ombres·off · isf 256 · étendues 0 · ×1.25');
  const u = texteCrans({ msaa: 4, gtao: true, ombres: true, isf: 512, etendues: 2, apparitions: false, pixelRatio: 2, grain: false, bloom: false });
  assert.equal(u, 'msaa 4 · gtao · ombres · isf 512 · étendues 2 · apparitions·off · grain·off · bloom·off · ×2');
  assert.equal(texteCrans(null), '');
});

test('le cartouche ne se demande que par ?perf=1', () => {
  assert.equal(perfDemande('?perf=1'), true);
  assert.equal(perfDemande('?gouverneur=0&perf=1'), true);
  assert.equal(perfDemande('?perf=0'), false);
  assert.equal(perfDemande('?perf'), false);
  assert.equal(perfDemande(''), false);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
