// LA FUMÉE DE L'ÉDITEUR — chaque volet, dans chaque pièce, se rend.
//
// Un volet qui reste vide ne fait aucun bruit : l'exception est avalée, le
// panneau est blanc, l'auteur croit que rien ne marche. Cette sonde ouvre le
// build AUTEUR servi en local, entre dans chaque pièce, ouvre le volet Pièce,
// sélectionne la première œuvre et ouvre ses quatre sous-onglets, puis
// l'onglet Mixage ; elle mesure la taille du panneau à chaque fois et relève
// les erreurs de page et de console.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s &
//   npm run sonde:editeur          (PORT=8124 par défaut ; ROOMS=a,b,c pour restreindre)
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
const ROOMS = (process.env.ROOMS || 'entree,labo,archives,jardin,allee,bibliotheque,couloir-est,belvedere,face-1,annexe,shaders,dancefloor').split(',');
const SEUIL_PIECE = 4000;
// par sous-onglet : la fiche d'un décor tient en mille caractères, l'objet en plusieurs milliers
const SEUILS = { objet: 3000, aspect: 1200, son: 2500, fiche: 800 };
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await nav.newPage({ viewport: { width: 1400, height: 900 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  // gabarits/index.json est OPTIONNEL : l'éditeur sonde des gabarits de pièce
  // fournis par l'auteur et se tait s'il n'y en a pas — un 404 attendu
  page.on('response', (r) => { if (r.status() >= 400 && !/gabarits\/index\.json$/.test(r.url())) bruit.push(`[http ${r.status()}] ${r.url().replace(/^http:\/\/[^/]+/, '')}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.editor?.enabled, null, { timeout: 120000 });
  const taille = () => page.evaluate(() => document.querySelector('#editor-panel')?.innerHTML.length ?? 0);
  const onglet = async (cle) => { await page.evaluate((cle) => document.querySelector(`button[data-onglet="${cle}"]`)?.click(), cle); await page.waitForTimeout(250); };
  const sousOnglet = async (cle) => { await page.evaluate((cle) => document.querySelector(`button[data-sous-onglet="${cle}"]`)?.click(), cle); await page.waitForTimeout(250); };
  let echecs = 0;
  for (const id of ROOMS) {
    const avant = bruit.length;
    const ok = await page.evaluate(async (id) => { try { await window.__galerie.rooms.setCurrent(id, { instant: true }); window.__galerie.editor.select(null); return true; } catch (e) { return String(e); } }, id);
    if (ok !== true) { echecs++; console.log(`✗ ${id} : ${ok}`); continue; }
    await page.waitForTimeout(600);
    await onglet('piece');
    const piece = await taille();
    // la première œuvre de la pièce, ses quatre sous-onglets
    const premiere = await page.evaluate((id) => { const app = window.__galerie; const art = app.rooms.get(id)?.artworks?.[0]; if (!art) return null; app.editor.select({ type: 'artwork', artwork: art }); return art.config.id; }, id);
    const sous = {};
    if (premiere) {
      await page.waitForTimeout(400);
      await onglet('oeuvre');
      for (const s of ['objet', 'aspect', 'son', 'fiche']) { await sousOnglet(s); sous[s] = await taille(); }
      await page.evaluate(() => window.__galerie.editor.select(null));
    }
    const nouveaux = bruit.slice(avant);
    const bon = piece >= SEUIL_PIECE && (!premiere || Object.entries(sous).every(([k, t]) => t >= SEUILS[k])) && nouveaux.length === 0;
    if (!bon) echecs++;
    console.log(`${bon ? '✓' : '✗'} ${id} : volet Pièce ${piece} car.${premiere ? ` ; ${premiere} → ${Object.entries(sous).map(([k, v]) => `${k} ${v}`).join(', ')}` : ' ; pièce vide'}${nouveaux.length ? ` ; ${nouveaux.length} erreur(s)` : ''}`);
    for (const b of nouveaux) console.log(`    ${b}`);
  }
  await onglet('mixage');
  await page.waitForTimeout(1200);
  const mixage = await page.evaluate(() => ({ taille: document.querySelector('#editor-panel')?.innerHTML.length ?? 0, table: !!document.querySelector('[data-mixage]') }));
  const okMix = mixage.taille >= 1500 && mixage.table && bruit.length === 0;
  if (!okMix) echecs++;
  console.log(`${okMix ? '✓' : '✗'} mixage : ${mixage.taille} car., table ${mixage.table}`);
  console.log(`\n${echecs === 0 ? '✓' : '✗'} bilan : ${ROOMS.length} pièces, ${echecs} échec(s), ${bruit.length} erreur(s)`);
  await nav.close(); process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
