// LA CHARGE DES LIENS — mesurer avant d'optimiser.
//
// Chronomètre, image par image dans la pièce Dancefloor, ce que coûtent les
// analyseurs et les liens (Signaux, sol, lumières de pièce, module du
// monolithe) face au rendu des écrans ISF ; et, avec EDIT=1, le relevé du
// vu-mètre de l'éditeur. Les millisecondes sont celles du processeur qui
// exécute la sonde ; un téléphone est deux à trois fois plus lent en JS.
//
//   npm run build && npx http-server dist -p 8123 -s &        npm run sonde:charge
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s &   EDIT=1 npm run sonde:charge
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const EDIT = process.env.EDIT === '1';
const PORT = EDIT ? 8124 : 8123;
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  await page.goto(`http://localhost:${PORT}/index.html${EDIT ? '?edit' : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
  await page.evaluate(async () => { await window.__galerie.rooms.setCurrent('dancefloor', { instant: true }); });
  await page.waitForFunction(() => window.__galerie.artworks.find((a) => a.config.id === 'pulsation-dancefloor')?._stemsActive, null, { timeout: 90000 }).catch(() => {});
  if (EDIT) {
    await page.evaluate(() => { window.__galerie.editor.select(null); });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('button[data-onglet="piece"]')?.click());
    await page.waitForSelector('.lien-row[data-lien="brightness"][data-lien-p="df"]', { timeout: 30000, state: 'attached' });
  }
  await page.waitForTimeout(1500);
  const r = await page.evaluate((EDIT) => new Promise((res) => {
    const app = window.__galerie; const room = app.rooms.get('dancefloor');
    const mesures = {}; const note = (k, ms) => { const m = mesures[k] ??= { n: 0, total: 0, max: 0 }; m.n++; m.total += ms; m.max = Math.max(m.max, ms); };
    const envelopper = (obj, nom, cle) => { const f = obj[nom]; if (typeof f !== 'function') return; obj[nom] = function (...a) { const t = performance.now(); const r = f.apply(this, a); note(cle, performance.now() - t); return r; }; };
    envelopper(app.signaux, 'update', 'signaux.update (analyseurs + bandes)');
    envelopper(room.dancefloor, 'suivre', 'sol : liens (4)');
    envelopper(room.dancefloor, 'rendre', 'sol : horloge');
    envelopper(app.rooms, '_suivreLiensPiece', 'pièce : liens lumières (1)');
    const chat = app.artworks.find((a) => a.config.id === 'shader-cat-dancefloor');
    if (chat?._isfEcran) envelopper(chat._isfEcran, 'rendre', 'chat : rendu ISF (RTT)');
    if (chat) envelopper(chat, 'update', 'chat : update total (liens + RTT + modules)');
    const mono = app.artworks.find((a) => a.config.id === 'pulsation-dancefloor');
    const ar = mono?.modules.find((m) => m.params?.lien || m.analyser !== undefined);
    if (ar) envelopper(ar, 'update', 'monolithe : AudioReactive (lien bande)');
    envelopper(app.rooms, 'update', 'rooms.update total');
    if (EDIT) { const ins = app.editor.ui.inspector; envelopper(ins, 'observerLiens', 'éditeur : observerLiens (DOM, chaque image)'); envelopper(ins, 'peindreNiveau', 'éditeur : peindreNiveau (12 Hz)'); }
    let n = 0; const t0 = performance.now();
    const tic = () => { n++; if (n < 240) requestAnimationFrame(tic); else res({ images: n, duree: performance.now() - t0, analyseurs: app.signaux._ecoutes.size, mesures }); };
    requestAnimationFrame(tic);
  }), EDIT);
  console.log(`${EDIT ? 'ÉDITEUR' : 'VISITEUR'} — ${r.images} images en ${(r.duree / 1000).toFixed(1)} s (${(r.duree / r.images).toFixed(1)} ms/image, rendu logiciel), ${r.analyseurs} analyseur(s)`);
  const lignes = Object.entries(r.mesures).map(([k, m]) => [k, m.total / m.n, m.max, m.n]).sort((a, b) => b[1] - a[1]);
  for (const [k, moy, max, n] of lignes) console.log(`  ${k.padEnd(48)} moy ${moy.toFixed(3)} ms   max ${max.toFixed(2)} ms   (${n} appels)`);
  await nav.close();
})().catch((e) => { console.error('✗', e); process.exit(1); });
