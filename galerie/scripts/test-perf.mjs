/**
 * LE CARTOUCHE DE MESURE (ui/Perf.js) : la statistique glissante, les
 * nombres lisibles, les crans en mots, et le paramètre d'adresse.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { Statistiques, compact, texteCrans, perfDemande, textePhases, PHASES, bancDemande, texteBanc, VARIANTES_BANC, lancerBanc } from '../engine/src/ui/Perf.js';

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

test('les phases en une ligne : le total, son p95, puis chaque étape dans l\'ordre de la boucle', () => {
  assert.deepEqual(PHASES, ['maj', 'audio', 'lumiere', 'reflets', 'vistas', 'survol', 'rendu']);
  const ligne = textePhases({ maj: 1.24, audio: 0.4, lumiere: 0.31, reflets: 0.05, vistas: 0, survol: 0.2, rendu: 3.52 }, 5.72, 9.04);
  assert.equal(ligne, 'js 5.7 ms · p95 9.0 · maj 1.2 · audio 0.4 · lumière 0.3 · reflets 0.1 · apparitions 0.0 · survol 0.2 · rendu 3.5');
  assert.equal(textePhases(null), '');
  assert.equal(textePhases({ rendu: 2 }, 2, 2), 'js 2.0 ms · p95 2.0 · rendu 2.0', 'une phase absente ne s\'écrit pas');
});

test('le banc : ?banc=1 l\'implique et le demande, neuf variantes, un tableau avec l\'écart au témoin', () => {
  assert.equal(bancDemande('?banc=1'), true);
  assert.equal(bancDemande('?perf=1'), false);
  assert.equal(perfDemande('?banc=1'), true, 'le banc a besoin du cartouche');
  assert.deepEqual(VARIANTES_BANC.map((v) => v.id), ['temoin', 'densite1', 'nettete', 'bloom', 'lignes', 'lampes', 'msaa', 'survol', 'poussiere']);
  const t = texteBanc([{ id: 'temoin', nom: 'témoin', ms: 18.3, p95: 27 }, { id: 'bloom', nom: 'sans bloom', ms: 15.1, p95: 20.4, temoinMs: 18.3 }, { id: 'msaa', nom: 'sans msaa', ms: 18.9, p95: 26, temoinMs: 18.3 }], 'sans lignes (5/9)');
  assert.equal(t, 'témoin 18.3 · p95 27.0<br>sans bloom 15.1 · p95 20.4 (−3.2 vs 18.3)<br>sans msaa 18.9 · p95 26.0 (+0.6 vs 18.3)<br>… sans lignes (5/9)');
});

test('le banc enchaîne : pose, attend, mesure, remet, et passe à la suivante — chaque variante après son témoin', () => {
  const abonnes = []; const journal = [];
  const app = { onUpdate: (fn) => { abonnes.push(fn); return () => abonnes.splice(abonnes.indexOf(fn), 1); } };
  const poignee = { peindre: () => {}, encours: null, banc: null };
  const variantes = [
    { id: 'temoin', nom: 'témoin', poser: () => { journal.push('pose témoin'); return () => journal.push('remet témoin'); } },
    { id: 'x', nom: 'x', poser: () => { journal.push('pose x'); return () => journal.push('remet x'); } },
    { id: 'y', nom: 'y', attente: 0.3, poser: () => { journal.push('pose y'); return () => journal.push('remet y'); } }
  ];
  const banc = lancerBanc(app, poignee, { variantes, attente: 0.1, mesure: 0.2, horloge: null });   // sans horloge : le dt de la boucle
  const image = (dt) => { for (const fn of abonnes.slice()) fn(dt); };
  for (let i = 0; i < 4; i++) image(0.05);        // l'attente, puis les premières mesures
  assert.deepEqual(journal, ['pose témoin']);
  for (let i = 0; i < 4; i++) image(0.05);        // la mesure se termine : remise, variante suivante
  assert.deepEqual(journal, ['pose témoin', 'remet témoin', 'pose x']);
  assert.equal(banc.resultats.length, 1);
  assert.ok(Math.abs(banc.resultats[0].ms - 50) < 1e-6, `moyenne ${banc.resultats[0].ms}`);
  for (let i = 0; i < 8; i++) image(0.05);        // x mesurée, puis un témoin muet se pose avant y
  assert.deepEqual(journal, ['pose témoin', 'remet témoin', 'pose x', 'remet x']);
  assert.equal(banc.resultats.length, 2);
  assert.ok(Math.abs(banc.resultats[1].temoinMs - 50) < 1e-6, 'x se compare au témoin mesuré juste avant');
  for (let i = 0; i < 8; i++) image(0.05);        // le témoin muet ; y attend 0,3 s au lieu de 0,1
  assert.deepEqual(journal, ['pose témoin', 'remet témoin', 'pose x', 'remet x', 'pose y']);
  assert.equal(banc.resultats.length, 2, 'un témoin muet ne s\'affiche pas');
  for (let i = 0; i < 12; i++) image(0.05);
  assert.deepEqual(journal, ['pose témoin', 'remet témoin', 'pose x', 'remet x', 'pose y', 'remet y']);
  assert.equal(banc.resultats.length, 3);
  assert.equal(poignee.encours, 'banc terminé');
  assert.equal(abonnes.length, 0, 'le banc se désabonne à la fin');
  delete globalThis.window?.__galerieBanc;
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
