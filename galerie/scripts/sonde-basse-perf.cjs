// BASSE PERFORMANCE : le gouverneur descend jusqu'en bas, et le mode économe y va d'un coup.
//
// Le rendu logiciel du Chromium de test tourne à deux ou trois images par
// seconde : c'est la machine la plus lente qui soit, et le gouverneur doit
// y prendre TOUS ses crans, sans erreur. Puis `?eco` : le profil part d'en
// bas, les écrans ISF sont à 256, la case du menu est cochée ; la décocher
// efface la mémoire.
//
//   npm run build && npx http-server dist -p 8123 -s &     npm run sonde:basse-perf
// Demande Playwright et un Chromium (CHROMIUM=/chemin si besoin).
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8123;
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const dire = (ok, quoi) => console.log(`${ok ? '✓' : '✗'} ${quoi}`);
  let echecs = 0;
  // --- 1. le gouverneur, dans la pièce des shaders (écrans ISF, apparitions ailleurs)
  {
    const page = await nav.newPage({ viewport: { width: 1100, height: 700 }, locale: 'fr-FR' });
    const infos = []; const erreurs = [];
    page.on('console', (m) => { if (m.type() === 'info' && /\[galerie\] FPS bas|densité/.test(m.text())) infos.push(m.text().replace('[galerie] ', '')); });
    page.on('pageerror', (e) => erreurs.push(e.message.slice(0, 200)));
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
    await page.evaluate(() => document.querySelector('#enter-btn').click());
    await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
    await page.evaluate(async () => { await window.__galerie.rooms.setCurrent('shaders', { instant: true }); });
    const t0 = Date.now();
    await page.waitForFunction(() => { const q = window.__galerie.quality; return q.profile.msaa === 0 && !window.__galerie.gtao?.enabled && !q.profile.shadows && q.profile.isfResolution === 256 && q.profile.pixelRatio <= 0.75 && !q.profile.grain && !window.__galerie.sortie?.bloomActif; }, null, { timeout: 120000 }).catch(() => {});
    const etat = await page.evaluate(() => { const app = window.__galerie; const q = app.quality; const isf = app.artworks.filter((a) => a._isfEcran).map((a) => `${a.config.id} ${a._isfEcran._res}`); return { tier: q.profile.tier, msaa: q.profile.msaa, gtao: !!app.gtao?.enabled, ombres: q.profile.shadows, isf: q.profile.isfResolution, apparitions: !!app.vistas?.live, densite: q.profile.pixelRatio, nettete: q.profile.nettete, grain: q.profile.grain, bloom: !!app.sortie?.bloomActif, ecrans: isf }; });
    const bas = etat.msaa === 0 && !etat.gtao && !etat.ombres && etat.isf === 256 && !etat.apparitions && etat.densite <= 0.75 && !etat.grain && !etat.bloom && etat.ecrans.every((e) => /\b256$/.test(e));
    if (!bas || erreurs.length) echecs++;
    dire(bas && !erreurs.length, `1. gouverneur, tout en bas en ${Math.round((Date.now() - t0) / 1000)} s : ${JSON.stringify(etat)} ; ${erreurs.length} erreur(s)`);
    for (const i of infos) console.log(`    ${i}`);
    await page.close();
  }
  // --- 2. le mode économe par l'URL, et la case du menu
  {
    const page = await nav.newPage({ viewport: { width: 1100, height: 700 }, locale: 'fr-FR' });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message.slice(0, 200)));
    await page.goto(`http://localhost:${PORT}/index.html?eco`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
    await page.evaluate(() => document.querySelector('#enter-btn').click());
    await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
    await page.evaluate(async () => { await window.__galerie.rooms.setCurrent('shaders', { instant: true }); });
    await page.waitForFunction(() => window.__galerie.artworks.some((a) => a._isfEcran), null, { timeout: 60000 }).catch(() => {});
    const eco = await page.evaluate(() => { const app = window.__galerie; const q = app.quality; return { econome: q.econome, tier: q.profile.tier, msaa: q.profile.msaa, gtao: !!app.gtao?.enabled, ombres: q.profile.shadows, isf: q.profile.isfResolution, densite: q.profile.pixelRatio, ecrans: app.artworks.filter((a) => a._isfEcran).map((a) => a._isfEcran._res), memoire: localStorage.getItem('galerie-eco') }; });
    // le menu : la case est cochée ; la décocher efface la mémoire
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /menu/i.test(x.getAttribute('aria-label') ?? '') || /menu/i.test(x.id)); b?.click(); });
    await page.waitForSelector('#vm-eco', { timeout: 20000, state: 'attached' }).catch(() => {});
    const menu = await page.evaluate(() => { const c = document.querySelector('#vm-eco'); if (!c) return null; const avant = c.checked; c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return { avant, memoire: localStorage.getItem('galerie-eco'), note: document.querySelector('#vm-eco-note')?.textContent }; });
    const ok = eco.econome === true && /econome$/.test(eco.tier) && eco.msaa === 0 && !eco.gtao && !eco.ombres && eco.isf === 256 && eco.densite <= 1 && eco.ecrans.every((r) => r === 256) && (!menu || (menu.avant === true && menu.memoire === null && /prochain chargement|next time/.test(menu.note ?? '')));
    if (!ok || erreurs.length) echecs++;
    dire(ok && !erreurs.length, `2. ?eco : ${JSON.stringify(eco)} ; menu ${menu ? JSON.stringify(menu) : 'non ouvert'} ; ${erreurs.length} erreur(s)`);
    await page.close();
  }
  // --- 3. le mode économe À CHAUD, depuis un profil remonté de force : chaque cran touche le renderer
  {
    const page = await nav.newPage({ viewport: { width: 1100, height: 700 }, locale: 'fr-FR' });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message.slice(0, 200)));
    await page.goto(`http://localhost:${PORT}/index.html?eco=0`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
    await page.evaluate(() => document.querySelector('#enter-btn').click());
    await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
    await page.evaluate(async () => { await window.__galerie.rooms.setCurrent('shaders', { instant: true }); });
    await page.waitForFunction(() => window.__galerie.artworks.some((a) => a._isfEcran), null, { timeout: 60000 }).catch(() => {});
    const chaud = await page.evaluate(() => {
      const app = window.__galerie; const q = app.quality; const p = q.profile;
      // on remonte de force ce que le rendu logiciel avait déjà coupé
      p.msaa = 4; app.setMsaa?.(4); if (app.gtao) app.gtao.enabled = true;
      p.shadows = true; app.setShadowsEnabled?.(true);
      p.isfResolution = 512; app.setIsfResolution(512);
      if (app.vistas) app.vistas.live = true;
      p.pixelRatio = 1; app.renderer.setPixelRatio(1); p.grain = true; if (app.sortie) { app.sortie.grainActif = true; app.sortie.bloomActif = true; }
      const avant = { isf: app.artworks.filter((a) => a._isfEcran).map((a) => a._isfEcran._res), ombres: app.renderer.shadowMap.enabled };
      q.activerEconome(app);
      return { avant, apres: { econome: q.econome, tier: p.tier, msaa: p.msaa, gtao: !!app.gtao?.enabled, ombres: p.shadows, ombresRenderer: app.renderer.shadowMap.enabled, isf: p.isfResolution, ecrans: app.artworks.filter((a) => a._isfEcran).map((a) => a._isfEcran._res), apparitions: !!app.vistas?.live, densite: p.pixelRatio, ratioRenderer: app.renderer.getPixelRatio(), grain: p.grain, bloom: !!app.sortie?.bloomActif, memoire: localStorage.getItem('galerie-eco') } };
    });
    await page.evaluate(() => localStorage.removeItem('galerie-eco'));
    const a = chaud.apres;
    const ok = a.econome && /econome$/.test(a.tier) && a.msaa === 0 && !a.gtao && !a.ombres && !a.ombresRenderer && a.isf === 256 && a.ecrans.every((r) => r === 256) && chaud.avant.isf.every((r) => r === 512) && !a.apparitions && a.densite === 0.75 && Math.abs(a.ratioRenderer - 0.75) < 1e-6 && !a.grain && !a.bloom && a.memoire === '1';
    if (!ok || erreurs.length) echecs++;
    dire(ok && !erreurs.length, `3. économe à chaud : avant ISF ${chaud.avant.isf} ombres ${chaud.avant.ombres} → ${JSON.stringify(a)} ; ${erreurs.length} erreur(s)`);
    await page.close();
  }
  await nav.close();
  console.log(`\n${echecs ? '✗' : '✓'} bilan : ${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
