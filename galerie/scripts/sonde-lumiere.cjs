// LA LUMIÈRE À L'IMAGE — combien de pixels brûlent, avant et après un réglage.
//
// Trois vues du build visiteur, gouverneur figé (?gouverneur=0) pour que le
// bloom et l'écran ISF restent ce qu'un téléphone voit : l'entrée depuis
// l'arrivée, les Archives depuis l'arrivée, le chat du dancefloor approché
// (FocusCamera). Pour chacune : luminance moyenne, part des pixels brûlés
// (> 0,92) et clairs (> 0,75), sur l'image rendue. Les captures partent dans
// CAPTURES=dossier si on le demande.
//
//   npm run build && npx http-server dist -p 8123 -s &     npm run sonde:lumiere
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8123;
const VUES = [
  { id: 'entree', nom: 'entrée, arrivée' },
  { id: 'archives', nom: 'archives, arrivée' },
  { id: 'dancefloor', nom: 'dancefloor, chat approché', focus: 'shader-cat-dancefloor' },
  { id: 'shaders', nom: 'salle des shaders, chien approché', focus: 'shader-dog' }
];
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  await page.goto(`http://localhost:${PORT}/index.html?gouverneur=0`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
  const etat = await page.evaluate(() => ({ bloom: window.__galerie.sortie?.bloomActif, seuil: window.__galerie.bloom?.threshold, force: window.__galerie.bloom?.strength, profil: window.__galerie.quality.profile.tier, gouverneur: window.__galerie.quality.gouverneur }));
  console.log(`profil ${etat.profil}, gouverneur ${etat.gouverneur === false ? 'figé' : 'actif'}, bloom ${etat.bloom ? 'actif' : 'coupé'} (seuil ${etat.seuil}, force ${etat.force})`);
  for (const vue of VUES) {
    await page.evaluate(async (id) => { await window.__galerie.rooms.setCurrent(id, { instant: true }); }, vue.id);
    // toutes les œuvres de la pièce visibles (ou en erreur), avant de regarder
    await page.waitForFunction((id) => { const r = window.__galerie.rooms.get(id); return r?.artworks?.every((a) => a._visualLoaded || a.mediaError || !a._visualRequested); }, vue.id, { timeout: 90000 }).catch(() => {});
    if (vue.focus) {
      await page.evaluate((id) => { const a = window.__galerie.artworks.find((x) => x.config.id === id); a?.modules.find((m) => typeof m.focus === 'function')?.focus(); }, vue.focus);
      await page.waitForFunction((id) => window.__galerie.artworks.find((x) => x.config.id === id)?.modules.find((m) => m.state)?.state === 'focused', vue.focus, { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const app = window.__galerie; app.composer.render();
      const src = app.renderer.domElement; const c = document.createElement('canvas'); c.width = 320; c.height = 200;
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let somme = 0, brules = 0, clairs = 0; const n = c.width * c.height;
      for (let i = 0; i < d.length; i += 4) { const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; somme += l; if (l > 0.92) brules++; if (l > 0.75) clairs++; }
      return { moyenne: somme / n, brules: brules / n, clairs: clairs / n };
    });
    console.log(`${vue.nom.padEnd(36)} luminance moyenne ${(m.moyenne * 100).toFixed(1)} %   brûlés ${(m.brules * 100).toFixed(2)} %   clairs ${(m.clairs * 100).toFixed(2)} %`);
    if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/lumiere-${vue.id}.png` });
    if (vue.focus) await page.keyboard.press('Escape');
  }
  await nav.close();
})().catch((e) => { console.error('✗', e); process.exit(1); });
