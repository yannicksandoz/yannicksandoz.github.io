/**
 * LES GABARITS TIENNENT LA CHARTE (editor/gabarits/*.json, scripts/charte.mjs).
 *
 * Le modèle « salle » livrait une lampe-clé à 2,2 et 60° quand la charte
 * veut 3,5 ± 0,8 à 40 ± 8° : une pièce neuve naissait avec un écart dans
 * « la charte en direct » avant tout geste de l'auteur — la règle grondait
 * sur ce que l'outil venait de faire. Chaque gabarit du moteur est donc
 * jugé comme une pièce (`jugerSalle`, la même fonction que le rapport de
 * charte), et sa description ne promet pas un autre angle que celui qu'il
 * pose.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jugerSalle, CHARTE } from './charte.mjs';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'src', 'editor', 'gabarits');
const gabarits = readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ fichier: f, ...JSON.parse(readFileSync(join(dossier, f), 'utf8')) }));

console.log('\nles gabarits tiennent la charte');

test('les cinq gabarits du moteur sont là', () => {
  assert.deepEqual(gabarits.map((g) => g.fichier), ['archives.json', 'couloir.json', 'exterieur.json', 'salle.json', 'vide.json']);
});

for (const g of gabarits) {
  test(`${g.nom} : aucun écart de charte à la naissance`, () => {
    const dehors = g.fichier === 'exterieur.json';
    const ligne = jugerSalle({ id: g.fichier.replace('.json', ''), ...(g.piece ?? {}) }, new Map(), dehors);
    assert.deepEqual(ligne.fautes, [], ligne.fautes.join(' · '));
  });
}

test('une lampe-clé de gabarit est dans la bande de jour de la charte', () => {
  const { intensite, marge, elevation, margeElevation } = CHARTE.lumiere;
  for (const g of gabarits) {
    const k = g.piece?.keyLight;
    if (!k || typeof k !== 'object') continue;
    assert.ok(Math.abs(k.intensity - intensite) <= marge, `${g.nom} : intensité ${k.intensity}`);
    assert.ok(Math.abs(k.elevation - elevation) <= margeElevation, `${g.nom} : élévation ${k.elevation}°`);
  }
});

test('la description d\'un gabarit ne promet pas un autre angle que celui qu\'il pose', () => {
  for (const g of gabarits) {
    const m = /(\d+)\s*°/.exec(g.description ?? '');
    if (!m) continue;
    assert.equal(Number(m[1]), g.piece?.keyLight?.elevation, `${g.nom} : « ${g.description} »`);
  }
});

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
