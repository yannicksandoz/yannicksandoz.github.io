// LES VISUELS DE TOUTES LES PIÈCES — plus jamais de cube rouge sans le savoir.
//
// Balaie chaque pièce du build VISITEUR servi en local et relève chaque œuvre
// dont le visuel n'a pas chargé (mediaError → silhouette rouge), avec la
// cause : erreurs console, réponses HTTP ≥ 400. Une seconde passe revient
// dans les premières pièces (libération au-delà de loadDistance, puis
// rechargement). Le mode PERIME=1 coupe le morceau GLTFLoader du build,
// comme quand la page a été ouverte avant un redéploiement : on attend alors
// le bandeau « nouvelle version en ligne » et des rouges qui le disent.
//
//   npm run build && npx http-server dist -p 8123 -s &
//   npm run sonde:visuels           (PORT=8123 par défaut ; ROOMS=a,b,c pour restreindre)
//   PERIME=1 npm run sonde:visuels
//
// Demande Playwright (npm i -D playwright, ou NODE_PATH vers une installation
// globale) et un Chromium ; CHROMIUM=/chemin/vers/chromium si besoin.
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8123;
const PERIME = process.env.PERIME === '1';
const ROOMS = (process.env.ROOMS || 'entree,labo,archives,jardin,allee,bibliotheque,couloir-est,belvedere,face-1,face-2,face-3,face-4,face-5,face-6,annexe,shaders,dancefloor').split(',');
const SECONDE_PASSE = PERIME ? [] : ['entree', 'jardin'];
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  const console_ = []; const http = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console_.push(`[${m.type()}] ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => console_.push(`[pageerror] ${e.message.slice(0, 220)}`));
  page.on('response', (r) => { if (r.status() >= 400) http.push(`${r.status()} ${r.url().replace(/^http:\/\/[^/]+/, '')}`); });
  if (PERIME) await page.route('**/assets/GLTFLoader-*.js', (route) => route.abort('failed'));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
  const bilan = [];
  const visiter = async (id, passe) => {
    const avantC = console_.length; const avantH = http.length;
    const ok = await page.evaluate(async (id) => { try { await window.__galerie.rooms.setCurrent(id, { instant: true }); return true; } catch (e) { return String(e); } }, id);
    if (ok !== true) { bilan.push({ id, passe, erreur: `setCurrent : ${ok}` }); console.log(`✗ ${id} : ${ok}`); return; }
    const t0 = Date.now(); let etat;
    while (Date.now() - t0 < 60000) {
      etat = await page.evaluate((id) => (window.__galerie.rooms.get(id)?.artworks ?? []).map((a) => ({ id: a.config.id, demande: !!a._visualRequested, charge: !!a._visualLoaded, erreur: a.mediaError ?? null,
        type: a.config.scan ? 'scan' : a.config.image ? 'image' : a.config.video ? 'vidéo' : a.config.model?.url ? `modèle ${a.config.model.url.split('/').pop()}` : a.config.model?.type ?? a.config.model?.shape ?? '?' })), id);
      if (etat.every((a) => a.charge || a.erreur)) break;
      await page.waitForTimeout(1000);
    }
    const attente = Math.round((Date.now() - t0) / 100) / 10;
    const rouges = etat.filter((a) => a.erreur); const enPanne = etat.filter((a) => !a.charge && !a.erreur);
    bilan.push({ id, passe, n: etat.length, attente, rouges, enPanne, console: console_.slice(avantC), http: http.slice(avantH) });
    const tag = rouges.length || enPanne.length ? '✗' : '✓';
    console.log(`${tag} ${passe}${id} : ${etat.length} œuvres, ${attente} s${rouges.length ? ` — ROUGES ${rouges.map((a) => `${a.id} (${a.type} : ${a.erreur})`).join(' ; ')}` : ''}${enPanne.length ? ` — SANS VISUEL ${enPanne.map((a) => `${a.id} (${a.type}, demandé ${a.demande})`).join(' ; ')}` : ''}`);
    for (const c of console_.slice(avantC)) console.log(`    ${c}`);
    for (const h of http.slice(avantH)) console.log(`    HTTP ${h}`);
  };
  for (const id of ROOMS) await visiter(id, '');
  for (const id of SECONDE_PASSE) await visiter(id, '↻ ');
  const rougesTotal = bilan.reduce((n, b) => n + (b.rouges?.length ?? 0), 0);
  const pannes = bilan.reduce((n, b) => n + (b.enPanne?.length ?? 0), 0);
  if (PERIME) {
    // le bandeau doit s'être montré, et les rouges dire « nouvelle version »
    await page.waitForFunction(() => !document.getElementById('version-perimee')?.hidden, null, { timeout: 15000 }).catch(() => {});
    const bandeau = await page.evaluate(() => { const el = document.getElementById('version-perimee'); return { visible: el && !el.hidden, texte: el?.textContent.replace(/\s+/g, ' ').trim(), rechauffes: window.__galerie.chunksRechauffes ?? null }; });
    const disent = bilan.flatMap((b) => b.rouges ?? []).filter((a) => /nouvelle version/.test(a.erreur)).length;
    const ok = bandeau.visible && /nouvelle version/i.test(bandeau.texte) && rougesTotal > 0 && disent === rougesTotal;
    console.log(`\n${ok ? '✓' : '✗'} page périmée : bandeau ${bandeau.visible ? 'visible' : 'ABSENT'} « ${bandeau.texte} » ; ${rougesTotal} rouges, ${disent} disent « nouvelle version » ; réchauffage ${JSON.stringify(bandeau.rechauffes)}`);
    await nav.close(); process.exit(ok ? 0 : 1);
  }
  const rechauffes = await page.evaluate(() => window.__galerie.chunksRechauffes ?? null);
  const bandeau = await page.evaluate(() => !document.getElementById('version-perimee')?.hidden);
  const ok = rougesTotal === 0 && pannes === 0 && http.length === 0 && !bandeau;
  console.log(`\n${ok ? '✓' : '✗'} bilan : ${rougesTotal} rouge(s), ${pannes} sans visuel, ${http.length} réponse(s) HTTP ≥ 400, bandeau ${bandeau ? 'VISIBLE' : 'caché'}, morceaux réchauffés ${JSON.stringify(rechauffes)}`);
  await nav.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('✗', e); process.exit(1); });
