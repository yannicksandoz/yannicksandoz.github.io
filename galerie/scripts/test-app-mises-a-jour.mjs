/**
 * LES MISES À JOUR SANS RELEASE (app/mises-a-jour-regles.cjs) : l'info de
 * build embarquée, les requêtes vers l'API publique, les commits concernés
 * sans doublon ni le build lui-même, les textes. Tout au nœud, sans Electron
 * ni réseau. Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CHEMINS_SURVEILLES, COMMANDE_BUILD, normaliserInfoBuild, urlsCommits, commitsConcernes, texteMiseAJour, texteAPropos } = require('../app/mises-a-jour-regles.cjs');

let ok = 0; let ko = 0;
const test = (nom, fn) => { try { fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\nles mises à jour de l’application, sans Release');

test('l’info de build : normalisée, ou null si elle n’a pas la forme', () => {
  const b = normaliserInfoBuild({ version: '1.0.0-beta.11', commit: '5c4db20abcdef', commitEditeur: '06e38d5', branche: 'master', date: '2026-10-05T08:00:00Z', plateforme: 'darwin', arch: 'arm64' });
  assert.equal(b.commit, '5c4db20');
  assert.equal(b.date, '2026-10-05T08:00:00.000Z');
  assert.equal(normaliserInfoBuild(null), null);
  assert.equal(normaliserInfoBuild({ commit: 'pas-un-sha', date: '2026-10-05' }), null);
  assert.equal(normaliserInfoBuild({ commit: 'abcdef1', date: 'hier' }), null);
});

test('les requêtes : une par chemin surveillé, master, depuis la date du build, sans jeton', () => {
  const urls = urlsCommits({ depuis: '2026-10-05T08:00:00.000Z' });
  assert.equal(urls.length, CHEMINS_SURVEILLES.length);
  assert.ok(urls[0].startsWith('https://api.github.com/repos/yannicksandoz/yannicksandoz.github.io/commits?sha=master&path=galerie%2Fengine&since=2026-10-05T08%3A00%3A00.000Z'));
  assert.ok(CHEMINS_SURVEILLES.includes('galerie/app') && CHEMINS_SURVEILLES.includes('galerie/content/shaders'));
  assert.ok(!CHEMINS_SURVEILLES.some((c) => /content\/(works|rooms|audio)/.test(c)), 'le contenu ne compte pas : l’application le sert en direct');
  assert.ok(urlsCommits({ base: 'http://127.0.0.1:1', depuis: 'x' })[0].startsWith('http://127.0.0.1:1/'), 'une base locale pour les sondes');
});

const commit = (sha, date, message) => ({ sha, commit: { message, committer: { date } } });
const build = { version: '1.0.0-beta.11', commit: 'aaaaaaa', branche: 'master', date: '2026-10-05T08:00:00.000Z' };

test('les commits concernés : sans doublon entre chemins, sans le build lui-même, le plus récent d’abord', () => {
  const l1 = [commit('ccccccc1', '2026-10-06T10:00:00Z', 'moteur : plafond'), commit('aaaaaaa9', '2026-10-05T07:00:00Z', 'le build')];
  const l2 = [commit('ccccccc1', '2026-10-06T10:00:00Z', 'moteur : plafond'), commit('ddddddd2', '2026-10-07T09:00:00Z', 'app : à propos\n\ndétail')];
  const r = commitsConcernes([l1, l2, null, { message: 'API rate limit' }], build);
  assert.deepEqual(r.map((c) => c.sha), ['ddddddd', 'ccccccc']);
  assert.equal(r[0].message, 'app : à propos', 'la première ligne du message');
  assert.deepEqual(commitsConcernes([[]], build), []);
});

test('les textes : à jour, en retard avec la commande, à propos', () => {
  assert.match(texteMiseAJour({ version: '1.0.0-beta.11', build, commits: [] }), /à jour/);
  const t = texteMiseAJour({ version: '1.0.0-beta.11', build, commits: Array.from({ length: 7 }, (_, i) => ({ sha: `c${i}`, message: `commit ${i}`, date: '' })) });
  assert.match(t, /Le code a avancé depuis ton build \(7 commits concernés\) — relance npm run app:mac/);
  assert.match(t, /… et 2 autres/);
  assert.equal(COMMANDE_BUILD, 'npm run app:mac');
  const ap = texteAPropos({ version: '1.0.0-beta.11', build: { ...build, commitEditeur: '06e38d5', plateforme: 'darwin', arch: 'arm64' }, versions: { electron: '44.4.5', chrome: '140', node: '22' } });
  assert.match(ap, /commit aaaaaaa \(éditeur 06e38d5\), branche master, darwin arm64/);
  assert.match(texteAPropos({ version: '1.0.0-beta.11', build: null }), /build de développement/);
});

console.log(`\n${ok} ✓ / ${ko} ✗`);
process.exit(ko ? 1 : 0);
