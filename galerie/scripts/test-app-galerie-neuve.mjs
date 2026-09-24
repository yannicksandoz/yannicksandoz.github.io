/**
 * UNE GALERIE NEUVE (app/galerie-neuve.cjs).
 *
 * Le plan : une salle d'entrée à la charte, des index, des réglages ; les
 * partagés copiés depuis le build ; jamais dans un dossier qui n'est pas
 * vide. Tout au nœud, sans Electron.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planGalerieNeuve, creerGalerie, dossierVide, PARTAGES } = require('../app/galerie-neuve.cjs');
const { jugerSalle } = await import('./charte.mjs').catch(() => ({ jugerSalle: null }));

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nune galerie neuve');

await test('le plan : une salle d\'entrée, les index, les réglages, les partagés', () => {
  const plan = planGalerieNeuve({ titre: 'Ma galerie' });
  const chemins = plan.fichiers.map((f) => f.chemin);
  assert.deepEqual(chemins, ['rooms/index.json', 'rooms/entree.json', 'works/index.json', 'reglages.json', '.gitignore']);
  assert.match(plan.fichiers[4].contenu, /\.sauvegardes\//);
  const salle = JSON.parse(plan.fichiers[1].contenu);
  assert.equal(salle.id, 'entree');
  assert.equal(salle.title, 'Ma galerie');
  assert.equal(salle.keyLight.intensity, 3.5);
  assert.equal(salle.keyLight.elevation, 40);
  assert.deepEqual(JSON.parse(plan.fichiers[0].contenu), ['entree.json']);
  assert.deepEqual(JSON.parse(plan.fichiers[2].contenu), []);
  assert.deepEqual(plan.partages, PARTAGES);
  if (jugerSalle) {
    const bilan = jugerSalle(salle, new Map(), false);
    assert.deepEqual(bilan.fautes, [], 'la salle neuve tient la charte');
  }
});

const tmp = mkdtempSync(join(tmpdir(), 'galerie-neuve-'));
const build = join(tmp, 'build');
mkdirSync(join(build, 'library'), { recursive: true });
mkdirSync(join(build, 'shaders'), { recursive: true });
writeFileSync(join(build, 'library', 'index.json'), '{"items":[]}');
writeFileSync(join(build, 'shaders', 'x.fs'), 'void main(){}');
writeFileSync(join(build, 'RIGHTS.md'), '# droits');

await test('créer : les fichiers écrits, les partagés présents copiés, les absents ignorés', async () => {
  const dossier = join(tmp, 'neuve');
  const r = await creerGalerie(dossier, { titre: 'Neuve', partagesDepuis: build });
  assert.deepEqual(r.partages, ['library', 'shaders', 'RIGHTS.md']);
  assert.ok(existsSync(join(dossier, 'rooms', 'entree.json')));
  assert.ok(existsSync(join(dossier, 'library', 'index.json')));
  assert.ok(!existsSync(join(dossier, 'textures')));
  assert.equal(JSON.parse(readFileSync(join(dossier, 'rooms', 'entree.json'), 'utf8')).title, 'Neuve');
});

await test('jamais dans un dossier qui n\'est pas vide ; un .DS_Store ne compte pas', async () => {
  assert.equal(await dossierVide(join(tmp, 'absent')), true);
  const presque = join(tmp, 'presque'); mkdirSync(presque); writeFileSync(join(presque, '.DS_Store'), '');
  assert.equal(await dossierVide(presque), true);
  let refuse = false;
  try { await creerGalerie(join(tmp, 'neuve'), { partagesDepuis: build }); } catch { refuse = true; }
  assert.ok(refuse);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
