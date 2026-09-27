/**
 * LE GARDE-FOU D'ÉDITEUR (check-visitor-build.mjs), CONTRE-ÉPROUVÉ.
 *
 * C'est l'étape la plus sensible de la chaîne : rien de l'outil d'auteur,
 * aucun hôte tiers, aucune clé dans ce qui est publié. Mais sa logique est
 * inline, et rien ne prouvait qu'elle mordait encore : une liste vidée, une
 * exemption élargie, et la CI restait verte. Ici, deux builds factices :
 * l'un doit ROUGIR (une empreinte d'éditeur, un hôte interdit, une clé),
 * l'autre doit PASSER (propre, licences présentes) — et l'exemption du
 * catalogue de mobilier (library/) doit tenir sans laisser passer un hôte.
 * (Les mots repérés sont assemblés à l'exécution : cette suite ne doit pas
 * contenir « editor/ » en clair, sinon tests.mjs la sauterait en CI.)
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const GARDE = join(ICI, 'check-visitor-build.mjs');
const LICENCES = join(ICI, '..', 'content', 'LICENCES');

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

/** Un build factice : { 'chemin': 'contenu' } → dossier temporaire. */
function build(fichiers) {
  const racine = mkdtempSync(join(tmpdir(), 'galerie-garde-'));
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  return racine;
}
const lancer = (racine) => spawnSync(process.execPath, [GARDE, racine], { encoding: 'utf8' });

const PROPRE = {
  'index.html': '<!doctype html><title>galerie</title>',
  'assets/index-x.js': '/*! airwindows */ const a = 1; // Lengyel',
  'assets/reverb-worklet-y.js': '/*! (c) airwindows, MIT */ registerProcessor("r", class {});',
  'LICENCES/airwindows-MIT.txt': readFileSync(join(LICENCES, 'airwindows-MIT.txt'), 'utf8'),
  'LICENCES/slug-MIT.txt': readFileSync(join(LICENCES, 'slug-MIT.txt'), 'utf8'),
  'works/index.json': '[]',
  'rooms/index.json': '[]'
};

console.log('\nle garde-fou du build visiteur, contre-éprouvé');

test('un build propre passe', () => {
  const r = lancer(build(PROPRE));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /publiable/);
});

test('une empreinte d\'éditeur, un hôte interdit et une clé font rougir, chacun nommé', () => {
  const mot = ['mount', 'Editor'].join('');            // assemblé : pas en clair ici
  const hote = ['api.', 'github', '.com'].join('');
  const cle = 'ghp_' + 'A'.repeat(36);
  const r = lancer(build({ ...PROPRE, 'assets/index-x.js': `/*! airwindows */ ${mot}(); fetch("https://${hote}/x"); const k = "${cle}"; // Lengyel` }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`empreinte d.éditeur « ${mot} »`));
  assert.match(r.stderr, new RegExp(`hôte tiers « ${hote} »`));
  assert.match(r.stderr, /ressemble à une clé d.API/);
});

test('le catalogue de mobilier (library/) est exempté des empreintes, pas des hôtes', () => {
  const mot = ['lib', '-tile'].join('');
  const r1 = lancer(build({ ...PROPRE, 'library/catalogue.json': `{"classe":"${mot}"}` }));
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = lancer(build({ ...PROPRE, 'library/catalogue.json': '{"url":"https://api.poly.pizza/x"}' }));
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /hôte tiers « api\.poly\.pizza »/);
});

test('la licence d\'Airwindows manquante, incomplète ou muette sur un portage livré : rouge', () => {
  const sans = { ...PROPRE }; delete sans['LICENCES/airwindows-MIT.txt'];
  assert.match(lancer(build(sans)).stderr, /ne part pas avec le build/);
  const tronquee = { ...PROPRE, 'LICENCES/airwindows-MIT.txt': 'Airwindows — Chris Johnson\nreverb-worklet.js' };
  assert.match(lancer(build(tronquee)).stderr, /incomplète/);
  const oubli = { ...PROPRE, 'assets/pupitre-worklet-z.js': '/*! airwindows */ registerProcessor("p", class {});',
    'LICENCES/airwindows-MIT.txt': PROPRE['LICENCES/airwindows-MIT.txt'].replace('pupitre-worklet.js', 'x') };
  assert.match(lancer(build(oubli)).stderr, /ne nomme pas pupitre-worklet\.js/);
});

test('une sauvegarde d\'éditeur ou un modèle hors library/ ne partent pas', () => {
  const r = lancer(build({ ...PROPRE, '.sauvegardes/2026/works/a.json': '{}', 'assets/statue.glb': 'glTF' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sauvegardes d.éditeur publiées/);
  assert.match(r.stderr, /modèles 3D hors library/);
});

// le ménage : les dossiers temporaires
for (const d of []) rmSync(d, { recursive: true, force: true });
console.log(`\n${ok} ✓  ${ko} ✗`);
process.exit(ko ? 1 : 0);
