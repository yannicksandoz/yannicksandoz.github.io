/**
 * UNE PIÈCE DEPUIS LES SONS — l'assistant « Archives », logique pure.
 *
 *   1. la disposition qui va de soi : ligne jusqu'à trois, grille au-delà,
 *      les préréglages 2×2, 3×2, 3×4 d'abord ;
 *   2. les stèles sont centrées, espacées du pas, la dernière rangée
 *      incomplète reste centrée, et la salle grandit avec le lot ;
 *   3. une couleur par stèle, toutes distinctes ; un cartel par son, tiré du
 *      nom de fichier et des métadonnées ;
 *   4. la pièce complète : ids uniques contre le document, une stèle par
 *      son (rôle œuvre), le mobilier en décor, les crédits reportés, le
 *      gabarit « Archives » du moteur valide et lisible.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRILLES, PAS, STELE, FINITIONS, ECLAIRAGES, dispositionAuto,
  normaliserDisposition, grilleEffective, positionsSteles, dimensionsPiece, couleurStele,
  cartelDepuisSon, steleDepuisSon, mobilierArchives, pieceDepuisSons, resumePiece }
  from '../engine/src/editor/state/PieceDepuisSons.js';
import { validerGabarit, instancierGabarit } from '../engine/src/editor/state/Gabarits.js';
import { estOeuvre } from '../engine/src/core/catalogue.js';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);
const ici = dirname(fileURLToPath(import.meta.url));
const GABARIT = JSON.parse(readFileSync(
  join(ici, '..', 'engine', 'src', 'editor', 'gabarits', 'archives.json'), 'utf8'));

const sons = (n) => Array.from({ length: n }, (_, i) => ({
  path: `assets/archive-${i + 1}.wav`, name: `archive-${i + 1}.wav`
}));
const doc = () => ({
  rooms: [{ id: 'archives', title: 'Archives', works: ['archives-lanterne'] }],
  works: [{ id: 'archives-lanterne', role: 'decor' }]
});

titre('la disposition qui va de soi');
test('jusqu\'à trois sons : une ligne', () => {
  for (const n of [1, 2, 3]) assert.deepEqual(dispositionAuto(n), { mode: 'ligne', cols: n, rangs: 1 });
});
test('quatre → 2×2, six → 3×2, douze → 3×4 : les préréglages d\'abord', () => {
  assert.deepEqual(dispositionAuto(4), { mode: 'grille', cols: 2, rangs: 2 });
  assert.deepEqual(dispositionAuto(5), { mode: 'grille', cols: 3, rangs: 2 });
  assert.deepEqual(dispositionAuto(6), { mode: 'grille', cols: 3, rangs: 2 });
  assert.deepEqual(dispositionAuto(12), { mode: 'grille', cols: 3, rangs: 4 });
  assert.deepEqual(GRILLES, [[2, 2], [3, 2], [3, 4]]);
});
test('sept → 3×3 (deux places libres), pas 3×4 (cinq)', () => {
  assert.deepEqual(dispositionAuto(7), { mode: 'grille', cols: 3, rangs: 3 });
  assert.deepEqual(grilleEffective(7, dispositionAuto(7)), { mode: 'grille', cols: 3, rangs: 3, libres: 2 });
});
test('une grille demandée est une capacité : 3×4 pour sept sons garde cinq places', () => {
  const g = grilleEffective(7, { mode: 'grille', cols: 3, rangs: 4 });
  assert.deepEqual(g, { mode: 'grille', cols: 3, rangs: 4, libres: 5 });
  const large = dimensionsPiece(7, { mode: 'grille', cols: 3, rangs: 4 }, PAS.normal);
  const juste = dimensionsPiece(7, dispositionAuto(7), PAS.normal);
  assert.ok(large.depth > juste.depth, 'la salle est taillée pour douze');
  // 2×2 pour six sons : il faut trois rangées, pas deux
  assert.deepEqual(grilleEffective(6, { mode: 'grille', cols: 2, rangs: 2 }), { mode: 'grille', cols: 2, rangs: 3, libres: 0 });
});
test('au-delà des préréglages : la grille la plus carrée', () => {
  assert.deepEqual(dispositionAuto(20), { mode: 'grille', cols: 5, rangs: 4 });
});
test('normaliser : mode inconnu → auto, colonnes bornées, rangées déduites', () => {
  assert.deepEqual(normaliserDisposition(null, 6), { mode: 'grille', cols: 3, rangs: 2 });
  assert.deepEqual(normaliserDisposition({ mode: 'grille', cols: 4 }, 6), { mode: 'grille', cols: 4, rangs: 2 });
  assert.deepEqual(normaliserDisposition({ mode: 'grille', cols: 99 }, 6), { mode: 'grille', cols: 12, rangs: 1 });
  assert.deepEqual(normaliserDisposition({ mode: 'ligne' }, 6), { mode: 'ligne', cols: 6, rangs: 1 });
});

titre('les stèles au sol');
test('en ligne : centrées, espacées du pas, posées (y = demi-hauteur)', () => {
  const p = positionsSteles(3, { mode: 'ligne' }, 4.5);
  assert.deepEqual(p, [[-4.5, 0.65, 0], [0, 0.65, 0], [4.5, 0.65, 0]]);
  assert.equal(STELE.hauteur / 2, 0.65);
});
test('en grille 3×2 : deux rangées, la première au fond', () => {
  const p = positionsSteles(6, { mode: 'grille', cols: 3, rangs: 2 }, 4);
  assert.deepEqual(p.map(([x, , z]) => [x, z]),
    [[-4, -2], [0, -2], [4, -2], [-4, 2], [0, 2], [4, 2]]);
});
test('dernière rangée incomplète : centrée', () => {
  const p = positionsSteles(5, { mode: 'grille', cols: 3, rangs: 2 }, 4);
  assert.deepEqual(p.slice(3).map(([x]) => x), [-2, 2]);
});
test('la salle grandit avec le lot, jamais sous 14 m', () => {
  const petite = dimensionsPiece(1, dispositionAuto(1), PAS.normal);
  assert.equal(petite.width, 14);
  assert.equal(petite.depth, 14);
  const grande = dimensionsPiece(12, dispositionAuto(12), PAS.normal);
  assert.ok(grande.width > petite.width && grande.depth > grande.width, JSON.stringify(grande));
  assert.ok(grande.floorSize >= Math.max(grande.width, grande.depth));
  const large = dimensionsPiece(12, dispositionAuto(12), PAS.large);
  assert.ok(large.depth > grande.depth, 'le pas large agrandit');
});

titre('couleurs et cartels');
test('douze stèles, douze couleurs distinctes, lumière de même famille', () => {
  const c = Array.from({ length: 12 }, (_, i) => couleurStele(i, 12));
  assert.equal(new Set(c.map((x) => x.color)).size, 12);
  assert.equal(new Set(c.map((x) => x.lightColor)).size, 12);
  for (const x of c) assert.match(x.color, /^#[0-9a-f]{6}$/);
});
test('cartel : titre depuis le fichier, description avec la place dans la série', () => {
  const c = cartelDepuisSon({ path: 'assets/marees-basse_v2.wav' }, 1, 4);
  assert.equal(c.title, 'Marees basse v2');
  assert.match(c.description, /Archive sonore 2 sur 4/);
  assert.doesNotMatch(c.description, /Source/);
});
test('cartel : l\'auteur et la licence d\'un son de banque sont cités', () => {
  const c = cartelDepuisSon({ path: 'x/chute-d-eau.mp3',
    meta: { source: 'freesound', author: 'ivolipa', license: 'CC0-1.0' } }, 0, 1);
  assert.equal(c.title, 'Chute d eau');
  assert.match(c.description, /ivolipa \(CC0-1\.0\)/);
});
test('stèle : boîte polie, une piste à 8 m, crédit seulement s\'il y a quelqu\'un à citer', () => {
  const locale = steleDepuisSon({ path: 'a/b.wav' }, 0, 1, [0, 0.65, 0]);
  assert.deepEqual(locale.scale, [0.9, 1.3, 0.9]);
  assert.equal(locale.model.shape, 'box');
  assert.deepEqual(locale.stems, [{ file: 'a/b.wav', radius: 8, gain: 0.8 }]);
  assert.ok(!('credit' in locale), 'pas de crédit vide');
  const banque = steleDepuisSon({ path: 'a/c.wav',
    meta: { source: 'freesound', author: 'Matio888', license: 'CC-BY-4.0', sourceUrl: 'https://freesound.org/s/1' } },
  0, 1, [0, 0.65, 0]);
  assert.deepEqual(banque.credit, { author: 'Matio888', license: 'CC-BY-4.0', sourceUrl: 'https://freesound.org/s/1' });
  assert.equal(banque.stems[0].source, 'freesound');
  assert.equal(banque.stems[0].credit.author, 'Matio888');
});

titre('le mobilier, taillé à la salle');
test('aux cotes des Archives (26 × 20 × 7,5), les mêmes positions que le contenu', () => {
  const m = mobilierArchives({ width: 26, depth: 20, height: 7.5 });
  assert.equal(m.length, 6);
  assert.deepEqual(m[0].position, [-11, 0.88, -9.45]);
  assert.deepEqual(m[1].position, [12.45, 0.88, -8]);
  const nord = m.find((x) => x.model.mur === 'nord');
  assert.deepEqual(nord.position, [0, 6.4, -9.2]);
  assert.equal(nord.model.longueur, 24.4);
  assert.equal(m.find((x) => x.model.mur === 'ouest').model.longueur, 18.4);
  assert.ok(m.every((x) => x.role === 'decor'));
});
test('éclairage nocturne : ni lanterne ni corniche ; muséal : corniches seules', () => {
  assert.equal(mobilierArchives({ width: 20, depth: 20, height: 7 }, ECLAIRAGES.nuit).length, 0);
  assert.equal(mobilierArchives({ width: 20, depth: 20, height: 7 }, ECLAIRAGES.musee).length, 4);
});

titre('la pièce complète');
test('six sons : six stèles (œuvres), le mobilier (décor), ids uniques et libres', () => {
  const d = doc();
  const { piece, meubles, oeuvres } = pieceDepuisSons({ sons: sons(6), nom: 'Archives', gabarit: GABARIT }, d);
  assert.equal(piece.id, 'archives-1', 'l\'id « archives » est pris par la pièce existante');
  assert.equal(piece.title, 'Archives');
  assert.equal(oeuvres.length, 6);
  assert.ok(oeuvres.every(estOeuvre), 'une stèle est une œuvre');
  assert.equal(meubles.length, 6);
  assert.ok(meubles.every((m) => m.role === 'decor'));
  const ids = [...oeuvres, ...meubles].map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'ids en double');
  assert.ok(!ids.includes('archives-lanterne'));
  assert.deepEqual(piece.works, ids);
  assert.deepEqual(piece.portals, []);
  assert.equal(piece.shell.texture, 'brique-vraie');
  assert.equal(piece.floor.texture, 'bois');
  assert.equal(piece.keyLight, false);
  assert.equal(piece.reverb.actif, true);
  assert.ok(piece.spawn[2] > 0 && piece.spawn[2] < piece.shell.depth / 2, 'l\'arrivée est devant, dans la salle');
  for (const o of oeuvres) {
    assert.ok(Math.abs(o.position[0]) < piece.shell.width / 2 - 2, `${o.id} hors des murs`);
    assert.ok(Math.abs(o.position[2]) < piece.shell.depth / 2 - 2, `${o.id} hors des murs`);
  }
});
test('les choix : ligne, pierre claire, muséal, pas large', () => {
  const r = pieceDepuisSons({ sons: sons(4), nom: 'Mes archives', disposition: { mode: 'ligne' },
    finition: 'pierre', eclairage: 'musee', pas: 'large' }, doc());
  assert.equal(r.piece.id, 'mes-archives-1');
  assert.equal(r.disposition.mode, 'ligne');
  assert.equal(new Set(r.oeuvres.map((o) => o.position[2])).size, 1, 'une seule rangée');
  assert.equal(r.oeuvres[1].position[0] - r.oeuvres[0].position[0], 6);
  assert.equal(r.piece.floor.texture, FINITIONS.pierre.floor.texture);
  assert.equal(r.piece.keyLight.elevation, 60);
  assert.equal(r.meubles.length, 4, 'muséal : corniches seules');
  assert.equal(r.piece.envIntensity, 1);
});
test('deux sons de même nom : deux stèles, deux ids', () => {
  const r = pieceDepuisSons({ sons: [{ path: 'a/voix.wav' }, { path: 'b/voix.wav' }] }, doc());
  assert.equal(r.oeuvres.length, 2);
  assert.notEqual(r.oeuvres[0].id, r.oeuvres[1].id);
});
test('sans son : refus explicite', () => {
  assert.throws(() => pieceDepuisSons({ sons: [] }, doc()), /aucun son/);
});
test('un résumé lisible pour l\'aperçu', () => {
  assert.match(resumePiece(6, dispositionAuto(6)), /^6 stèles en grille 3 × 2 — salle de \d+(\.\d+)? × \d+(\.\d+)? m$/);
  assert.match(resumePiece(5, { mode: 'grille', cols: 3, rangs: 2 }), /1 place\(s\) libre/);
  assert.match(resumePiece(7, { mode: 'grille', cols: 3, rangs: 4 }), /3 × 4, 5 place\(s\) libre/);
  assert.match(resumePiece(6, { mode: 'grille', cols: 2, rangs: 2 }), /^6 stèles en grille 2 × 3 — /);
  assert.match(resumePiece(2, { mode: 'ligne' }), /^2 stèles en ligne/);
});

titre('le gabarit « Archives » du moteur');
test('valide, et instanciable en salle vide meublée', () => {
  assert.deepEqual(validerGabarit(GABARIT), []);
  const { piece, meubles } = instancierGabarit(GABARIT, doc());
  assert.equal(meubles.length, 6);
  assert.equal(piece.shell.width, 26);
  assert.ok(piece.works.length === 6 && piece.portals.length === 0);
});

console.log(`\n${ko ? '✗' : '✓'} test-piece-sons : ${ok} ok, ${ko} ko`);
if (ko) process.exit(1);
