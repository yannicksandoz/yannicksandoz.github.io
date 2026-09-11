// LE POIDS DU SON À L'ENTRÉE — réseau, mémoire décodée, délai du premier son.
//
// Ce que coûte l'audio de la pièce d'arrivée : les octets téléchargés, le PCM
// décodé qui reste en mémoire, et le temps jusqu'au premier son. C'est la
// mesure qui a motivé la lecture par fragments (core/fragments.js), et celle
// qui dit si elle tient ses promesses.
//
//   npm run build && npx http-server dist -p 8123 -s &
//   npm run sonde:poids-audio        (ROOM=archives WORK=stele-archives-1 pour une autre pièce)
//
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8123;
const ROOM = process.env.ROOM || 'entree';
const WORK = process.env.WORK || 'banc-entree';
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  const reseau = new Map(); // url → octets
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\.(wav|mp3|webm|m4a|opus|ogg|flac|fragments\.json)(\?|$)/i.test(u)) return;
    try { const b = await r.body(); reseau.set(u.replace(/^http:\/\/[^/]+\//, ''), (reseau.get(u) ?? 0) + b.length); } catch {}
  });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
  if (ROOM !== 'entree') await page.evaluate(async (id) => { await window.__galerie.rooms.setCurrent(id, { instant: true }); }, ROOM);
  await page.waitForFunction((id) => window.__galerie.artworks.find((a) => a.config.id === id)?._stemsActive, WORK, { timeout: 120000 });
  const premierSon = Date.now() - t0;
  await page.waitForTimeout(Number(process.env.ATTENTE || 12000));
  const mem = await page.evaluate(async (id) => {
    const app = window.__galerie; let octets = 0, n = 0;
    for (const p of app.audio._cache.values()) { try { const b = await p; octets += b.length * b.numberOfChannels * 4; n++; } catch {} }
    const art = app.artworks.find((a) => a.config.id === id);
    const lecteurs = (art?.stems ?? []).filter((s) => s.lecteur).map((s) => ({ residents: s.lecteur.residents?.() ?? null, position: s.lecteur.position?.() ?? null }));
    return { octets, n, heap: performance.memory?.usedJSHeapSize ?? null, lecteurs, actif: art?._stemsActive };
  }, WORK);
  const total = [...reseau.values()].reduce((a, b) => a + b, 0);
  const Mo = (b) => (b / 1048576).toFixed(2);
  console.log(`pièce ${ROOM}, œuvre ${WORK} — premier son après ${(premierSon / 1000).toFixed(1)} s (chargement compris)`);
  console.log(`réseau audio : ${Mo(total)} Mo en ${reseau.size} fichier(s)`);
  for (const [u, b] of [...reseau.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${Mo(b).padStart(6)} Mo  ${u}`);
  console.log(`mémoire décodée (PCM résident) : ${Mo(mem.octets)} Mo en ${mem.n} tampon(s)${mem.heap ? ` ; tas JS ${Mo(mem.heap)} Mo` : ''}`);
  if (mem.lecteurs.length) console.log(`lecteurs par fragments : ${JSON.stringify(mem.lecteurs)}`);
  await nav.close();
})().catch((e) => { console.error('✗', e); process.exit(1); });
