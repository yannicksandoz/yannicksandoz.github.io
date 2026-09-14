// LE LISERÉ SUIT-IL L'ŒUVRE ? — mesure image par image, pendant un geste et après.
// À chaque image rendue : la boîte du masque (pixels blancs de la cible de
// survol) contre la boîte projetée de l'œuvre avec la caméra de CETTE image.
// Un fantôme = un écart qui grandit pendant le geste. Puis, à l'arrêt : la
// couronne dans l'image finale (diff avec/sans contour) — épaisseur et marges.
//   npm run build && npx http-server dist -p 8123 -s &     npm run sonde:lisere
//   MOBILE=1 pour un iPhone émulé (profil mobile, densité 3) ; ROOM= et CIBLE=
//   pour une autre œuvre ; DETAIL=1 imprime les trois dernières mesures.
const { chromium, devices } = require('playwright');
const PORT = process.env.PORT || 8123;
const MOBILE = process.env.MOBILE === '1';
const ROOM = process.env.ROOM || 'labo';
const CIBLE = process.env.CIBLE || 'marees';
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage(MOBILE ? { ...devices['iPhone 13'], locale: 'fr-FR' } : { viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_debug_renderer_info' ? null : g.call(this, n); }; } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${PORT}/index.html?gouverneur=0`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('#enter-btn').click());
  await page.waitForFunction(() => window.__galerie?.rooms?.current, null, { timeout: 120000 });
  await page.evaluate(async (id) => { await window.__galerie.rooms.setCurrent(id, { instant: true }); }, ROOM);
  await page.waitForFunction((id) => { const r = window.__galerie.rooms.get(id); return r?.artworks?.every((a) => a._visualLoaded || a.mediaError || !a._visualRequested); }, ROOM, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const etat = await page.evaluate(() => { const s = window.__galerie.survol; return { profil: window.__galerie.quality.profile.tier, echelle: s.echelle, echantillons: s.echantillons, occlusion: s.occlusion, densite: window.devicePixelRatio }; });
  console.log(`profil ${etat.profil}, densité ${etat.densite}, masque échelle ${etat.echelle}, MSAA ${etat.echantillons}, occlusion ${etat.occlusion}`);

  // la mesure, installée dans la page : vise l'œuvre, puis à chaque image
  // rendue compare masque et projection
  const ok = await page.evaluate((cible) => {
    const app = window.__galerie; const THREE = app.THREE;
    const art = app.artworks.find((a) => a.config.id === cible);
    if (!art?.mesh) return `œuvre ${cible} introuvable ou sans mesh`;
    // la visée est FIGÉE sur l'œuvre : l'application re-vise à chaque image
    // (le pointeur, ou le centre au tactile), ce n'est pas ce qu'on mesure
    app._viserSurvol = () => {};
    app.survol.viser(art);
    // la tourner vers l'œuvre : la cible d'orbite dans la direction de l'œuvre
    const cam = new THREE.Vector3(); app.camera.getWorldPosition(cam);
    const centre = new THREE.Box3().setFromObject(art.mesh).getCenter(new THREE.Vector3());
    const dir = centre.clone().sub(cam).normalize();
    app.controls.orbit.target.copy(cam).add(dir.multiplyScalar(4));
    window.__mesures = []; window.__mesurer = true;
    const boiteProjetee = () => {
      // la silhouette VRAIE : chaque sommet de chaque mesh, projeté, puis
      // borné à l'écran (le masque, lui, s'arrête au bord de l'image)
      const t = app.renderer.getDrawingBufferSize(new THREE.Vector2());
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; const v = new THREE.Vector3();
      art.mesh.updateMatrixWorld(true);
      art.mesh.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position || o.userData.horsSurvol) return;
        const pos = o.geometry.attributes.position; const pas = Math.max(1, Math.floor(pos.count / 4000));
        for (let i = 0; i < pos.count; i += pas) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(app.camera);
          if (v.z > 1) continue;
          const x = (v.x + 1) / 2 * t.x, y = (1 - v.y) / 2 * t.y;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      });
      return { x0: Math.max(0, x0), x1: Math.min(t.x, x1), y0: Math.max(0, y0), y1: Math.min(t.y, y1), W: t.x, H: t.y, brut: { x0, x1, y0, y1 } };
    };
    const boiteMasque = () => {
      const rt = app.survol._rt; if (!rt) return null;
      const w = rt.width, h = rt.height; const buf = new Uint8Array(w * h * 4);
      app.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (buf[(y * w + x) * 4] > 128) { n++; const ye = h - 1 - y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, ye); y1 = Math.max(y1, ye); }
      }
      return n ? { x0, x1: x1 + 1, y0, y1: y1 + 1, n, w, h } : { n: 0, w, h };
    };
    const rendu = app.composer.render.bind(app.composer);
    app.composer.render = (...a) => {
      const r = rendu(...a);
      if (window.__mesurer) {
        const p = boiteProjetee(); const m = boiteMasque();
        window.__mesures.push({ t: performance.now(), force: app.survol.force, p, m,
          ecart: m?.n ? { g: m.x0 - p.x0, d: m.x1 - p.x1, h: m.y0 - p.y0, b: m.y1 - p.y1 } : null });
      }
      return r;
    };
    window.__couronne = () => {
      // l'image avec le contour, puis SANS, à la même caméra et au même instant
      const u = app.sortie.uniforms; const src = app.renderer.domElement;
      const lire = () => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const g = c.getContext('2d'); g.drawImage(src, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      rendu(); const A = lire();
      const f = u.uContour.value; u.uContour.value = 0; rendu(); const B = lire(); u.uContour.value = f;
      const p = boiteProjetee(); const W = src.width, H = src.height;
      const marge = 40; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0;
      const X0 = Math.max(0, Math.floor(p.x0 - marge)), X1 = Math.min(W, Math.ceil(p.x1 + marge));
      const Y0 = Math.max(0, Math.floor(p.y0 - marge)), Y1 = Math.min(H, Math.ceil(p.y1 + marge));
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * W + x) * 4;
        const dl = Math.abs((0.2126 * (A[i] - B[i]) + 0.7152 * (A[i + 1] - B[i + 1]) + 0.0722 * (A[i + 2] - B[i + 2])) / 255);
        if (dl > 0.05) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      const perim = 2 * ((p.x1 - p.x0) + (p.y1 - p.y0));
      return { n, epaisseur: n / perim, marges: n ? { g: p.x0 - x0, d: x1 + 1 - p.x1, h: p.y0 - y0, b: y1 + 1 - p.y1 } : null, boite: p, force: app.survol.force };
    };
    return true;
  }, CIBLE);
  if (ok !== true) { console.log('✗', ok); await nav.close(); process.exit(1); }
  await page.waitForTimeout(600);
  // un geste : glisser le doigt/la souris de gauche à droite en huit pas
  const vp = page.viewportSize(); const cx = vp.width / 2, cy = vp.height / 2;
  await page.mouse.move(cx - 60, cy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(cx - 60 + i * 6, cy + (i % 2) * 2); await page.waitForTimeout(40); }
  await page.mouse.up();
  await page.waitForTimeout(1200); // l'inertie s'éteint
  const mesures = await page.evaluate(() => { window.__mesurer = false; return window.__mesures; });
  const couronne = await page.evaluate(() => window.__couronne());
  if (process.env.DETAIL) { for (const m of mesures.slice(-3)) console.log(JSON.stringify(m)); console.log(JSON.stringify(couronne)); }
  await nav.close();
  const utiles = mesures.filter((m) => m.ecart && m.force >= 0.99);
  const maxEcart = (l) => l.reduce((n, m) => Math.max(n, ...Object.values(m.ecart).map(Math.abs)), 0);
  const nb = utiles.length; const fin = utiles.slice(-3);
  const boitesBougent = utiles.length > 2 ? Math.abs(utiles[0].p.x0 - utiles[utiles.length - 1].p.x0) : 0;
  console.log(`${nb} images mesurées, masque ${utiles[0]?.m.w}×${utiles[0]?.m.h} pour une image ${utiles[0]?.p.W}×${utiles[0]?.p.H}`);
  console.log(`l'œuvre a glissé de ${boitesBougent.toFixed(0)} px à l'écran pendant le geste`);
  console.log(`écart masque / projection : max ${maxEcart(utiles).toFixed(1)} px pendant le geste, ${maxEcart(fin).toFixed(1)} px à l'arrêt`);
  if (couronne.marges) console.log(`couronne : épaisseur moyenne ${couronne.epaisseur.toFixed(1)} px, marges gauche ${couronne.marges.g} droite ${couronne.marges.d} haut ${couronne.marges.h} bas ${couronne.marges.b} px (${couronne.n} pixels touchés)`);
  else console.log(`couronne : aucun pixel changé (force ${couronne.force})`);
  const fantome = maxEcart(utiles) > 3 || (couronne.marges && Math.max(...Object.values(couronne.marges).map(Math.abs)) > 8);
  console.log(fantome ? '✗ le liseré ne colle pas à l\'œuvre' : '✓ le liseré colle à l\'œuvre');
})().catch((e) => { console.error('✗', e); process.exit(1); });
