/**
 * LE BUILD LOCAL de l'application (scripts/app-local-regles.mjs) : la cible
 * sur ce poste (un .dmg seulement sur un Mac, l'architecture détectée,
 * l'universel sur demande), le dépôt qui doit être propre et le sous-module
 * au commit référencé, l'info de build, la marche à suivre.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { ciblePour, etatDepot, infoBuild, marcheASuivre } from './app-local-regles.mjs';

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nle build local de l’application');

test('la cible : un .dmg sur un Mac seulement, l’architecture du poste, l’universel sur demande', () => {
  assert.deepEqual(ciblePour({ cible: 'mac', plateforme: 'darwin', arch: 'arm64' }).args, ['--mac', '--arm64', '--publish', 'never']);
  assert.deepEqual(ciblePour({ cible: 'mac', plateforme: 'darwin', arch: 'x64' }).args, ['--mac', '--x64', '--publish', 'never']);
  const u = ciblePour({ cible: 'mac', plateforme: 'darwin', arch: 'arm64', universel: true });
  assert.deepEqual(u.args, ['--mac', '--universal', '--publish', 'never']);
  assert.match(u.archLibelle, /universel/);
  assert.match(ciblePour({ cible: 'mac', plateforme: 'linux', arch: 'x64' }).erreur, /sur un Mac .*workflow/);
  assert.match(ciblePour({ cible: 'win', plateforme: 'darwin', arch: 'arm64' }).erreur, /Windows/);
  assert.deepEqual(ciblePour({ cible: 'linux', plateforme: 'linux', arch: 'x64' }).args, ['--linux', '--publish', 'never']);
  assert.match(ciblePour({ cible: 'bsd', plateforme: 'linux' }).erreur, /inconnue/);
});

test('le dépôt : propre et sous-module au commit référencé, sinon des raisons claires', () => {
  assert.deepEqual(etatDepot({ porcelain: '', porcelainEditeur: '', sousModule: ' 06e38d5 galerie/engine/src/editor (heads/master)' }), { ok: true, raisons: [] });
  assert.equal(etatDepot({ porcelain: '?? app/build-info.json\n', sousModule: ' 06e38d5 x' }).ok, true, 'l’info de build écrite par le script ne salit pas le dépôt');
  const sale = etatDepot({ porcelain: ' M galerie/README.md\n?? galerie/x.js\n', porcelainEditeur: ' M Editor.js\n', sousModule: '+06e38d5 galerie/engine/src/editor (heads/master)' });
  assert.equal(sale.ok, false);
  assert.equal(sale.raisons.length, 3);
  assert.match(sale.raisons[0], /le site a des changements non commités \(2\) : galerie\/README.md, galerie\/x.js/);
  assert.match(sale.raisons[1], /l'éditeur a des changements/);
  assert.match(sale.raisons[2], /pas au commit que le site référence/);
  assert.match(etatDepot({ sousModule: '-06e38d5 galerie/engine/src/editor' }).raisons[0], /pas initialisé/);
});

test('l’info de build : SHA courts, date ISO, la version telle quelle', () => {
  const i = infoBuild({ version: '1.0.0-beta.11', commit: '5c4db20abcdef0123', commitEditeur: '06e38d58cc', branche: 'master', date: '2026-10-05T08:00:00Z', plateforme: 'darwin', arch: 'arm64', cible: 'mac' });
  assert.equal(i.commit, '5c4db20');
  assert.equal(i.commitEditeur, '06e38d5');
  assert.equal(i.date, '2026-10-05T08:00:00.000Z');
  assert.equal(i.version, '1.0.0-beta.11');
  assert.equal(i.universel, false);
});

test('la marche à suivre : le chemin, puis glisser dans Applications ; pas de contournement Gatekeeper pour un build local', () => {
  const l = marcheASuivre({ cible: 'mac', chemins: ['/x/app-dist/Galerie auteur-1.0.0-beta.11-mac.dmg'] });
  assert.match(l[0], /app-dist/);
  assert.match(l[1], /quitter l’ancienne application.*Applications/);
  assert.match(l[2], /pas de quarantaine.*Ouvrir quand même/);
  assert.ok(!l.join(' ').includes('xattr'), 'aucun xattr à documenter pour un build local');
  assert.match(marcheASuivre({ cible: 'win', chemins: [] })[0], /installateur/);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
