/**
 * GIT SANS TERMINAL (app/git-local.cjs).
 *
 * L'analyse du porcelain est pure ; le reste s'éprouve sur un vrai dépôt
 * temporaire : état, ajout limité au dossier de contenu, commit, refus du
 * commit vide, dossier hors dépôt. Sauté si git manque à la machine.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GitLocal, analyserPorcelain } = require('../app/git-local.cjs');

let ok = 0; let ko = 0;
const test = async (nom, fn) => { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom}\n      ${e.message}`); } };

console.log('\ngit sans terminal');

await test('le porcelain : ajoutés, modifiés, supprimés, renommés, conflits', () => {
  const b = analyserPorcelain(['?? content/works/a.json', ' M content/rooms/e.json', 'A  content/works/b.json',
    ' D content/works/c.json', 'R  content/works/d.json', 'content/works/old.json', 'UU content/x.json', ''].join('\0'));
  assert.deepEqual(b.ajoutes, ['content/works/a.json', 'content/works/b.json']);
  assert.deepEqual(b.modifies, ['content/rooms/e.json']);
  assert.deepEqual(b.supprimes, ['content/works/c.json']);
  assert.deepEqual(b.renommes, ['content/works/d.json']);
  assert.deepEqual(b.conflits, ['content/x.json']);
  assert.equal(b.total, 6);
  assert.equal(analyserPorcelain('').total, 0);
});

const git = new GitLocal();
const version = await git.version();
if (!version) {
  console.log('  — git absent de cette machine : les cas sur dépôt sont sautés');
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'galerie-git-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@x' };
  const sh = (args, cwd = tmp) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();
  sh(['init', '-q', '-b', 'main']);
  sh(['config', 'user.name', 'Test']); sh(['config', 'user.email', 't@x']);
  mkdirSync(join(tmp, 'galerie', 'content', 'works'), { recursive: true });
  writeFileSync(join(tmp, 'galerie', 'content', 'works', 'index.json'), '[]');
  writeFileSync(join(tmp, 'ailleurs.txt'), 'hors contenu');
  sh(['add', '-A']); sh(['commit', '-q', '-m', 'départ']);
  const contenu = join(tmp, 'galerie', 'content');

  await test('le dépôt qui contient le dossier : racine, branche, chemin relatif', async () => {
    const d = await git.depot(contenu);
    assert.ok(d.racine.endsWith(tmp.split('/').pop()));
    assert.equal(d.branche, 'main');
    assert.equal(d.relatif, 'galerie/content');
    assert.equal(await git.depot(tmpdir()), null);
  });

  await test('les changements DU DOSSIER seulement, et le commit limité à lui', async () => {
    writeFileSync(join(contenu, 'works', 'index.json'), '["a.json"]');
    writeFileSync(join(contenu, 'works', 'a.json'), '{"id":"a"}');
    writeFileSync(join(tmp, 'ailleurs.txt'), 'modifié hors contenu');
    const c = await git.changements(contenu);
    assert.deepEqual(c.ajoutes, ['galerie/content/works/a.json']);
    assert.deepEqual(c.modifies, ['galerie/content/works/index.json']);
    assert.equal(c.total, 2);
    const r = await git.committer(contenu, 'Publication de la galerie');
    assert.ok(/^[0-9a-f]{7,}$/.test(r.sha));
    assert.equal(r.total, 2);
    assert.equal((await git.changements(contenu)).total, 0);
    // ce qui est hors du dossier n'a pas été emporté
    assert.ok(sh(['status', '--porcelain']).includes('ailleurs.txt'));
    assert.equal(sh(['log', '--oneline']).split('\n').filter(Boolean).length, 2);
  });

  await test('rien à committer, message vide, dossier hors dépôt : refusés en le disant', async () => {
    let m = '';
    try { await git.committer(contenu, 'encore'); } catch (e) { m = e.message; }
    assert.match(m, /Rien à committer/);
    try { await git.committer(contenu, '   '); } catch (e) { m = e.message; }
    assert.match(m, /vide/);
    try { await git.committer(tmpdir(), 'x'); } catch (e) { m = e.message; }
    assert.match(m, /pas dans un dépôt/);
  });

  await test('une suppression se voit avant d\'être engagée', async () => {
    unlinkSync(join(contenu, 'works', 'a.json'));
    const c = await git.changements(contenu);
    assert.deepEqual(c.supprimes, ['galerie/content/works/a.json']);
  });

  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${ok} ✓  ${ko} ✗`);
if (ko) process.exit(1);
