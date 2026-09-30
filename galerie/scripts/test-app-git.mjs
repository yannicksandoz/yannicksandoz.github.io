/**
 * GIT SANS TERMINAL (app/git-local.cjs).
 *
 * L'analyse du porcelain est pure ; le reste s'éprouve sur un vrai dépôt
 * temporaire : état, ajout limité au dossier de contenu, commit, refus du
 * commit vide, dossier hors dépôt. Sauté si git manque à la machine.
 * Lancer avec : npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
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

console.log('\npousser avec le jeton du compte, sans trousseau');
// un git factice : ce qu'il reçoit (arguments, environnement) est ce qui compte.
// La racine est un chemin RÉEL (macOS : /var est un lien vers /private/var ;
// Windows : un nom court) — depot() résout les deux côtés avant de comparer
const RACINE = realpathSync.native(tmpdir());
function gitFactice(adresse) {
  const appels = [];
  const racine = RACINE;
  const executer = async (args, cwd, options = {}) => {
    appels.push({ args, cwd, env: options.env ?? null });
    const a = args.join(' ');
    if (a === 'rev-parse --show-toplevel') return `${racine}\n`;
    if (a === 'rev-parse --abbrev-ref HEAD') return 'main\n';
    if (a === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return 'origin/main\n';
    if (a === 'remote get-url --push origin') return `${adresse}\n`;
    if (args.at(-1) === 'push') return '';
    throw new Error(`inattendu : git ${a}`);
  };
  return { git: new GitLocal({ executer }), appels, contenu: join(racine, 'galerie', 'content') };
}

await test('distant HTTPS github.com + jeton : assistants écartés, jeton dans l’environnement seulement', async () => {
  const { git, appels, contenu } = gitFactice('https://github.com/yannick/site.git');
  const r = await git.pousser(contenu, { jeton: 'ghp_secret123' });
  assert.equal(r.methode, 'jeton');
  const push = appels.find((a) => a.args.at(-1) === 'push');
  assert.ok(push, 'un push a eu lieu');
  assert.deepEqual(push.args.slice(0, 2), ['-c', 'credential.helper='], 'la liste des assistants est remise à vide d’abord');
  assert.match(push.args[3], /^credential\.helper=!f\(\) \{ .*\$GALERIE_JETON.*\}; f$/, 'un assistant éphémère qui lit la variable');
  assert.equal(push.env?.GALERIE_JETON, 'ghp_secret123');
  assert.ok(!push.args.some((x) => x.includes('ghp_secret123')), 'le jeton n’est jamais dans la ligne de commande');
});

await test('distant SSH, ou pas de jeton : le git de la machine, tel quel', async () => {
  const ssh = gitFactice('git@github.com:yannick/site.git');
  const r1 = await ssh.git.pousser(ssh.contenu, { jeton: 'ghp_x' });
  assert.equal(r1.methode, 'machine');
  assert.deepEqual(ssh.appels.find((a) => a.args.at(-1) === 'push').args, ['push']);
  const sans = gitFactice('https://github.com/yannick/site.git');
  const r2 = await sans.git.pousser(sans.contenu, {});
  assert.equal(r2.methode, 'machine');
  assert.ok(!sans.appels.some((a) => a.args.includes('remote')), 'sans jeton, on ne demande même pas l’adresse');
});

await test('refus d’identifiants : le conseil nomme le trousseau et le jeton du bloc 3', async () => {
  const racine = RACINE;
  const executer = async (args) => {
    const a = args.join(' ');
    if (a === 'rev-parse --show-toplevel') return `${racine}\n`;
    if (a === 'rev-parse --abbrev-ref HEAD') return 'main\n';
    if (args.at(-1) === 'push') { const e = new Error('git'); e.stderr = 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled\n'; throw e; }
    throw new Error(`inattendu : git ${a}`);
  };
  const g = new GitLocal({ executer });
  await assert.rejects(g.pousser(join(racine, 'galerie', 'content')), (e) => {
    assert.match(e.message, /^git push a échoué : fatal: could not read Username/);
    assert.match(e.message, /trousseau/);
    assert.match(e.message, /jeton GitHub dans le bloc 3/);
    return true;
  });
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
    // git rend la racine avec des barres obliques, même sur Windows ; le nom du dossier suffit
    assert.ok(d.racine.replace(/\\/g, '/').endsWith(basename(tmp)), `racine ${d.racine} pour ${tmp}`);
    assert.equal(d.branche, 'main');
    assert.equal(d.relatif, 'galerie/content');
    assert.equal(await git.depot(tmpdir()), null);
  });

  await test('le dossier donné par un lien symbolique (macOS : /var → /private/var) est bien dans le dépôt', async () => {
    const lien = join(tmpdir(), `galerie-git-lien-${process.pid}`);
    try { symlinkSync(tmp, lien, 'dir'); } catch { return; }   // pas de liens ici (Windows sans droit) : rien à prouver
    try {
      const d = await git.depot(join(lien, 'galerie', 'content'));
      assert.ok(d, 'le dépôt est trouvé à travers le lien');
      assert.equal(d.relatif, 'galerie/content');
      const c = await git.changements(join(lien, 'galerie', 'content'));
      assert.ok(c && Array.isArray(c.ajoutes), 'git status accepte le chemin relatif');
    } finally { unlinkSync(lien); }
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

  await test('pousser sans dépôt distant : refusé en nommant la cause, avec le conseil', async () => {
    await assert.rejects(git.pousser(contenu), (e) => {
      assert.match(e.message, /^git push a échoué : (fatal|error):/, `la cause en tête : « ${e.message} »`);
      assert.match(e.message, /distant|remote|destination|upstream/i, 'le message dit qu\'il manque un distant');
      assert.ok(!/git push <name>/.test(e.message), 'pas l\'aide de git en guise de message');
      return true;
    });
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
