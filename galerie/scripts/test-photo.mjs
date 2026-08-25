/**
 * LA PHOTO PATH-TRACÉE — l'outil d'auteur, éprouvé au nœud.
 *
 * Le rendu lui-même (échantillons, tone mapping, PNG) se juge au navigateur ;
 * ce qui s'éprouve ici est ce qui NE DOIT PAS dériver :
 *
 *   1. le module vit dans l'ÉDITEUR et s'importe DYNAMIQUEMENT — la
 *      bibliothèque ne pèse que dans le build Auteur, à son propre morceau ;
 *   2. les choix qui ne se voient pas restent écrits : la voie synchrone
 *      (`setScene` — `setSceneAsync` exige un worker BVH), le contournement
 *      du dispose amont cassé en 0.0.23, le rendu hors écran ;
 *   3. le garde-fou du build Visiteur connaît les empreintes de l'outil ;
 *   4. la dépendance est déclarée, à la version qui marche avec three r166,
 *      et sous MIT.
 *
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let ok = 0, ko = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { ko++; console.log(`  ✗ ${nom}\n    ${e.message}`); }
};
const titre = (t) => console.log(`\n${t}`);

const ici = dirname(fileURLToPath(import.meta.url));
const PHOTO = join(ici, '..', 'engine', 'src', 'editor', 'photo', 'Photo.js');
const src = readFileSync(PHOTO, 'utf8');

titre('le module vit à sa place, et s’importe à la demande');
test('EditorUI porte le bouton, et charge le module au clic', () => {
  const ui = readFileSync(join(ici, '..', 'engine', 'src', 'editor',
    'EditorUI.js'), 'utf8');
  assert.ok(ui.includes('data-a="photo"'), 'pas de bouton photo');
  assert.ok(ui.includes("import('./photo/Photo.js')"),
    'l’import doit rester dynamique — la bibliothèque dans son morceau');
});
test('Photo.js importe la bibliothèque dynamiquement aussi', () => {
  assert.ok(src.includes("await import('three-gpu-pathtracer')"),
    'un import statique la ferait peser dans le morceau éditeur');
});

titre('les choix qui ne se voient pas restent écrits');
test('la voie synchrone : setScene, pas setSceneAsync', () => {
  assert.ok(src.includes('traceur.setScene('), 'setScene absent');
  assert.ok(!src.includes('.setSceneAsync('),
    'setSceneAsync exige un worker BVH enregistré (setBVHWorker)');
});
test('le dispose amont de 0.0.23 est contourné, pas appelé', () => {
  // en 0.0.23, WebGLPathTracer.dispose() lit `this._renderQuad` qui
  // n'existe pas (le quad s'appelle `_quad`) : l'appel lèverait TOUJOURS,
  // depuis notre finally, et ferait échouer une photo réussie
  assert.ok(!src.includes('traceur.dispose()'),
    'traceur.dispose() lève toujours en 0.0.23 (_renderQuad inexistant)');
  for (const attendu of ['_quad', '_pathTracer', '_lowResPathTracer']) {
    assert.ok(src.includes(`traceur.${attendu}?.`), `${attendu} non libéré`);
  }
});
test('le rendu reste hors écran — la visite continue pendant la pose', () => {
  assert.ok(src.includes('renderToCanvas = false'));
});
test('la lecture des pixels passe par une cible sRGB huit bits', () => {
  assert.ok(src.includes('SRGBColorSpace'),
    'sans elle, le PNG serait linéaire — délavé partout sauf ici');
  assert.ok(src.includes('readRenderTargetPixels'));
});

titre('le garde-fou connaît l’outil');
test('les empreintes du build Visiteur incluent la photo', () => {
  const garde = readFileSync(join(ici, 'check-visitor-build.mjs'), 'utf8');
  assert.ok(garde.includes("'WebGLPathTracer'"), 'empreinte bibliothèque');
  assert.ok(garde.includes("'photo-progres'"), 'empreinte interface');
});

titre('la dépendance est déclarée, à la bonne version, en MIT');
test('package.json épingle la 0.0.23', () => {
  const p = JSON.parse(readFileSync(join(ici, '..', 'package.json'), 'utf8'));
  assert.ok(p.dependencies['three-gpu-pathtracer'],
    'three-gpu-pathtracer absent des dépendances');
  assert.match(p.dependencies['three-gpu-pathtracer'], /0\.0\.23/,
    'la 0.0.24 exige three >= 0.180 — la nôtre est r166');
});
test('la bibliothèque installée est bien MIT, de Garrett Johnson', () => {
  const lib = JSON.parse(readFileSync(join(ici, '..', 'node_modules',
    'three-gpu-pathtracer', 'package.json'), 'utf8'));
  assert.equal(lib.license, 'MIT');
  assert.match(String(lib.author ?? ''), /Garrett Johnson/);
});
test('…et créditée dans les avis tiers', () => {
  const avis = readFileSync(join(ici, '..', '..', 'THIRD-PARTY-NOTICES.md'),
    'utf8');
  assert.ok(avis.includes('three-gpu-pathtracer'));
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
