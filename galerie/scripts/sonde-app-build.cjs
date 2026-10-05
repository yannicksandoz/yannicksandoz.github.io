// LE BUILD EMBARQUÉ ET LES MISES À JOUR SANS RELEASE, dans l'application
// (Electron piloté par Playwright, sous Xvfb) : une info de build d'hier,
// un faux dépôt public qui répond deux commits concernés ; l'application
// les compte, propose la commande, son menu Aide montre le build et plus
// de page des Releases ; hors ligne, elle se tait.
//
//   npm run build:auteur
//   xvfb-run -a node scripts/sonde-app-build.cjs
const { _electron: electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
const racine = path.join(__dirname, '..');
const infoPath = path.join(racine, 'app', 'build-info.json');
const avant = fs.existsSync(infoPath) ? fs.readFileSync(infoPath) : null;
const commit = (sha, message) => ({ sha, commit: { message, committer: { date: '2026-10-06T10:00:00Z' } } });

(async () => {
  fs.writeFileSync(infoPath, JSON.stringify({ version: '0.0.0-sonde', commit: 'abc1234def0', commitEditeur: '0123456', branche: 'master',
    date: new Date(Date.now() - 86400e3).toISOString(), plateforme: process.platform, arch: process.arch }));
  const requetes = [];
  const srv = http.createServer((req, res) => {
    requetes.push(req.url);
    const chemin = new URL(req.url, 'http://x').searchParams.get('path');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(chemin === 'galerie/engine' ? [commit('1111111aaaa', 'moteur : plafond'), commit('abc1234def0', 'le build lui-même')]
      : chemin === 'galerie/app' ? [commit('1111111aaaa', 'moteur : plafond'), commit('2222222bbbb', 'app : à propos')] : []));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const lancer = async (api) => {
    const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'galerie-sonde-'));
    const app = await electron.launch({
      executablePath: path.join(racine, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
      args: ['.', '--no-sandbox'], cwd: racine,
      env: { ...process.env, GALERIE_SANS_DIALOGUE: '1', GALERIE_DONNEES: donnees, GALERIE_API_GITHUB: api }
    });
    const page = await app.firstWindow();
    // la première fenêtre naît vide, puis charge la galerie servie : on attend le pont
    await page.waitForFunction(() => Boolean(window.galerieApp?.etatVersion), null, { timeout: 60000 });
    return { app, page };
  };
  try {
    const { app, page } = await lancer(base);
    const etat = await page.evaluate(() => window.galerieApp.etatVersion());
    verif(etat.build?.commit === 'abc1234' && etat.build.branche === 'master', `la page connaît le build embarqué : ${etat.build?.commit} (${etat.build?.branche})`);
    verif(etat.commits === 2 && etat.nouvelle === true && etat.commande === 'npm run app:mac',
      `deux commits concernés depuis le build, sans doublon ni le build lui-même ; la commande ${etat.commande}`);
    verif(requetes.length === 7 && requetes.every((u) => /sha=master&path=galerie%2F/.test(u) && /since=/.test(u)) && requetes.some((u) => /galerie%2Fcontent%2Fshaders/.test(u)),
      `${requetes.length} requêtes à l'API publique, master, depuis la date du build, sans jeton`);
    const aide = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'Aide').submenu.items.map((i) => i.label));
    verif(aide.includes('À propos…') && aide.includes('Vérifier les mises à jour…') && aide.some((l) => /build abc1234/.test(l)) && !aide.some((l) => /Releases/.test(l)),
      `le menu Aide : ${aide.join(' · ')}`);
    await app.close();
    // hors ligne : rien à lire, pas de boîte, l'application vit
    const hors = await lancer('http://127.0.0.1:1');
    const e2 = await hors.page.evaluate(() => window.galerieApp.etatVersion());
    verif(e2.commits === null && e2.nouvelle === false && e2.build?.commit === 'abc1234', 'hors ligne : commits illisibles, rien de plus');
    await hors.app.close();
  } catch (e) {
    verif(false, `erreur : ${e?.message ?? e}`);
  } finally {
    srv.close();
    if (avant) fs.writeFileSync(infoPath, avant); else fs.rmSync(infoPath, { force: true });
  }
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  process.exit(echecs ? 1 : 0);
})();
