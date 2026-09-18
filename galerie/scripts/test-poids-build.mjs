/**
 * LE POIDS DU BUILD (poids-build.mjs) — le garde-fou de livraison.
 *
 * La logique pure d'abord : les trois mesures (paquet principal, JS total,
 * site hors médias) sur une liste de fichiers factice ; le verdict qui
 * nomme le fautif et le dépassement ; le rapport ; les seuils du dépôt,
 * bien formés. Puis, si `dist/` existe (en CI, après le build), le VRAI
 * contrôle : un build qui dépasse ses seuils fait rougir cette suite, donc
 * `npm test` — en plus de `npm run check`.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesurer, verdict, texteRapport, ko, controler, EXTENSIONS_MEDIAS, FICHIER_SEUILS } from './poids-build.mjs';

let ok = 0; let ko_ = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko_++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle poids du build');

const FICHIERS = [
  { chemin: 'index.html', taille: 10000 },
  { chemin: 'assets/index-AAA.js', taille: 500000 },
  { chemin: 'assets/index-BBB.js', taille: 90000 },   // un second index, plus petit : pas le paquet
  { chemin: 'assets/three-CCC.js', taille: 400000 },
  { chemin: 'assets/reverb-worklet-DDD.js', taille: 4000 },
  { chemin: 'assets/index-EEE.css', taille: 30000 },
  { chemin: 'works/works.json', taille: 70000 },
  { chemin: 'assets/sons/nappe.webm', taille: 3000000 },
  { chemin: 'assets/images/mur.JPG', taille: 800000 },
  { chemin: 'library/banc.glb', taille: 200000 }
];

test('le paquet principal est le plus gros assets/index-*.js, et lui seul', () => {
  const m = mesurer(FICHIERS);
  assert.equal(m.paquetPrincipal.taille, 500000);
  assert.equal(m.paquetPrincipal.fichiers[0].chemin, 'assets/index-AAA.js');
});

test('le JS total additionne tous les .js, du plus lourd au plus léger', () => {
  const m = mesurer(FICHIERS);
  assert.equal(m.jsTotal.taille, 500000 + 90000 + 400000 + 4000);
  assert.deepEqual(m.jsTotal.fichiers.map((f) => f.chemin).slice(0, 2), ['assets/index-AAA.js', 'assets/three-CCC.js']);
});

test('le site hors médias exclut sons, images (quelle que soit la casse) et modèles', () => {
  const m = mesurer(FICHIERS);
  assert.equal(m.siteHorsMedias.taille, 10000 + 500000 + 90000 + 400000 + 4000 + 30000 + 70000);
  assert.ok(EXTENSIONS_MEDIAS.has('.webm') && EXTENSIONS_MEDIAS.has('.glb') && !EXTENSIONS_MEDIAS.has('.js'));
});

test('sous les seuils : aucun manquement ; sans seuil : rien à dire', () => {
  const m = mesurer(FICHIERS);
  assert.deepEqual(verdict(m, { paquetPrincipal: 550000, jsTotal: 1100000, siteHorsMedias: 1200000 }), []);
  assert.deepEqual(verdict(m, {}), []);
  assert.deepEqual(verdict(m, { paquetPrincipal: 0 }), []);
});

test('le paquet qui dépasse : le manquement nomme le fichier et le dépassement', () => {
  const m = mesurer(FICHIERS);
  const [v] = verdict(m, { paquetPrincipal: 450000 });
  assert.equal(v.cle, 'paquetPrincipal');
  assert.equal(v.fichier, 'assets/index-AAA.js');
  assert.equal(v.depassement, 50000);
  assert.match(v.message, /paquet principal : 500 ko pour un seuil de 450 ko, dépassé de 50.0 ko \(11.1 %\)/);
  assert.match(v.message, /fichier fautif : assets\/index-AAA.js/);
});

test('un total qui dépasse nomme ses trois plus lourds', () => {
  const m = mesurer(FICHIERS);
  const [v] = verdict(m, { jsTotal: 900000 });
  assert.equal(v.cle, 'jsTotal');
  assert.match(v.message, /les plus lourds : assets\/index-AAA.js \(500 ko\), assets\/three-CCC.js \(400 ko\), assets\/index-BBB.js \(90.0 ko\)/);
});

test('le rapport dit chaque mesure, son seuil et la marge, ou le dépassement', () => {
  const m = mesurer(FICHIERS);
  const r = texteRapport(m, { paquetPrincipal: 550000, jsTotal: 900000 });
  assert.match(r, /paquet principal\s+500 ko\s+seuil\s+550 ko\s+marge 50.0 ko\s+assets\/index-AAA.js/);
  assert.match(r, /JavaScript total\s+994 ko\s+seuil\s+900 ko\s+DÉPASSÉ de 94.0 ko/);
  assert.match(r, /site hors médias\s+1104 ko\s+sans seuil/);
  assert.equal(ko(1234), '1.2 ko');
  assert.equal(ko(123456), '123 ko');
});

test('les seuils du dépôt sont trois entiers positifs', () => {
  const s = JSON.parse(readFileSync(FICHIER_SEUILS, 'utf8'));
  for (const k of ['paquetPrincipal', 'jsTotal', 'siteHorsMedias']) {
    assert.ok(Number.isInteger(s[k]) && s[k] > 0, `${k} : ${s[k]}`);
  }
  assert.ok(s.paquetPrincipal < s.jsTotal && s.jsTotal < s.siteHorsMedias, 'paquet < JS total < site hors médias');
});

// LE VRAI BUILD, s'il est là : le garde-fou en CI passe par ici aussi
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(join(dist, 'index.html'))) {
  const seuils = JSON.parse(readFileSync(FICHIER_SEUILS, 'utf8'));
  const { mesures, manquements } = await controler(dist, seuils);
  console.log('\n' + texteRapport(mesures, seuils).split('\n').map((l) => '    ' + l).join('\n'));
  test('le build de dist/ tient dans ses seuils (poids-seuils.json)', () => {
    assert.deepEqual(manquements.map((m) => m.message), []);
  });
} else {
  console.log('  – pas de dist/ : le contrôle du vrai build est sauté (npm run build d\'abord)');
}

console.log(`\n${ok} ✓  ${ko_} ✗`);
if (ko_) process.exit(1);
