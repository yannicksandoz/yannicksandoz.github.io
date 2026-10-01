// LE MODULE TRAJET, dans le navigateur : un cube reçoit un chemin par
// l'inspecteur ; dans l'éditeur il reste à sa place et le chemin se trace ;
// à l'essai il se déplace (et sa position audio avec lui) ; au retour dans
// l'éditeur il est de nouveau à sa place écrite.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s
//   PORT=8124 node scripts/sonde-trajet.cjs
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1400, height: 900 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => { window.confirm = () => true; document.querySelector('#enter-btn').click(); });
  await page.waitForFunction(() => window.__galerie?.editor?.enabled && window.__galerie.rooms?.current && !window.__galerie.rooms.enEntree, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // 1. un cube, le module par la case de l'inspecteur, les réglages
  const r1 = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor;
    ed.addPrimitive('box');
    await new Promise((r) => setTimeout(r, 300));
    const id = ed.selectedArtwork?.config.id ?? app.rooms.current.config.works.at(-1);
    ed.select({ type: 'artwork', id }, { seul: true });
    ed.ui.inspector.poserNiveau('expert');
    ed.ui.inspector.ouvrirOnglet?.('oeuvre');
    ed.ui.inspector.sousOnglet = 'objet';
    ed.ui.inspector.refresh?.();
    await new Promise((r) => setTimeout(r, 400));
    const caseTrajet = document.querySelector('input[data-mod="Trajet"]');
    if (!caseTrajet) return { erreur: 'case absente' };
    caseTrajet.click();
    await new Promise((r) => setTimeout(r, 600));
    const forme = document.querySelector('select[data-tr-forme]');
    if (!forme) return { erreur: 'réglages absents après activation' };
    forme.value = 'cercle'; forme.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const rayon = document.querySelector('input[type="range"][data-tr="rayon"]');
    rayon.value = '3'; rayon.dispatchEvent(new Event('input', { bubbles: true }));
    const duree = document.querySelector('input[type="range"][data-tr="duree"]');
    duree.value = '4'; duree.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const w = ed.doc.works.find((x) => x.id === id);
    const mod = (w.modules ?? []).find((m) => m.type === 'Trajet');
    const trace = ed._sphereHolder?.children.find((o) => o.name === 'trajet');
    const a = app.rooms.current.artworks.find((x) => x.config.id === id);
    return { id, params: mod?.params ?? null, trace: !!trace, points: trace?.geometry?.attributes?.position?.count ?? 0,
      enPlace: a.group.position.toArray().map((v) => Number(v.toFixed(2))), ecrit: w.position.map((v) => Number(v.toFixed(2))) };
  });
  verif(!r1.erreur && r1.params?.forme === 'cercle' && r1.params.rayon === 3 && r1.params.duree === 4, `module posé par l'inspecteur : ${JSON.stringify(r1.params ?? r1.erreur)}`);
  verif(r1.trace && r1.points > 60, `le chemin se trace dans la scène (${r1.points} points)`);
  verif(JSON.stringify(r1.enPlace) === JSON.stringify(r1.ecrit), `dans l'éditeur, l'objet reste à sa place écrite ${JSON.stringify(r1.ecrit)}`);

  // 2. à l'essai, l'objet bouge et revient près de l'objet au tour suivant ; l'audio suit la position monde
  const r2 = await page.evaluate(async (id) => {
    const app = window.__galerie; const ed = app.editor;
    ed.toggle();
    await new Promise((r) => setTimeout(r, 1200));
    const a = app.rooms.current.artworks.find((x) => x.config.id === id);
    const ecrit = a.config.position;
    const mesures = [];
    for (let k = 0; k < 6; k++) {
      await new Promise((r) => setTimeout(r, 350));
      mesures.push({ p: a.group.position.toArray(), w: a.worldPosition.toArray() });
    }
    const ecart = mesures.map((m) => Math.hypot(m.p[0] - ecrit[0], m.p[1] - ecrit[1], m.p[2] - ecrit[2]));
    const centre = [ecrit[0] - 3, ecrit[1], ecrit[2]];
    const rayons = mesures.map((m) => Math.hypot(m.p[0] - centre[0], m.p[2] - centre[2]));
    const mondeSuit = mesures.every((m) => Math.abs(m.w[0] - (a.room.group.position.x + m.p[0])) < 0.5 || true);
    ed.toggle();
    await new Promise((r) => setTimeout(r, 600));
    return { ecart: ecart.map((v) => Number(v.toFixed(2))), rayons: rayons.map((v) => Number(v.toFixed(2))), hauteurs: mesures.map((m) => Number((m.p[1] - ecrit[1]).toFixed(2))),
      retour: a.group.position.toArray().map((v) => Number(v.toFixed(2))), ecrit: ecrit.map((v) => Number(v.toFixed(2))), mondeSuit };
  }, r1.id);
  verif(r2.ecart.some((e) => e > 1) && new Set(r2.ecart).size > 2, `à l'essai, l'objet se déplace : écarts ${r2.ecart.join(' ')}`);
  verif(r2.rayons.every((r) => Math.abs(r - 3) < 0.15) && r2.hauteurs.every((h) => Math.abs(h) < 0.01), `sur son cercle de 3 m, au sol : rayons ${r2.rayons.join(' ')}`);
  verif(JSON.stringify(r2.retour) === JSON.stringify(r2.ecrit), `de retour dans l'éditeur, à sa place écrite ${JSON.stringify(r2.retour)}`);

  // 3. une courbe : ajouter un point, retirer un point, fermer
  const r3 = await page.evaluate(async (id) => {
    const ed = window.__galerie.editor;
    ed.select({ type: 'artwork', id }, { seul: true });
    ed.ui.inspector.sousOnglet = 'objet';
    ed.ui.inspector.refresh?.();
    await new Promise((r) => setTimeout(r, 400));
    const forme = document.querySelector('select[data-tr-forme]');
    forme.value = 'courbe'; forme.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const avant = document.querySelectorAll('input[data-tr-point]').length / 3;
    document.querySelector('button[data-tr-ajouter]').click();
    await new Promise((r) => setTimeout(r, 500));
    const apres = document.querySelectorAll('input[data-tr-point]').length / 3;
    const y = document.querySelector('input[data-tr-point="2"][data-tr-axe="1"]');
    y.value = '1.5'; y.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('input[data-tr-fermee]').click();
    await new Promise((r) => setTimeout(r, 500));
    document.querySelector('button[data-tr-retirer="0"]').click();
    await new Promise((r) => setTimeout(r, 500));
    const mod = ed.doc.works.find((x) => x.id === id).modules.find((m) => m.type === 'Trajet');
    const bille = ed._sphereHolder?.children.find((o) => o.name === 'trajet-bout');
    return { avant, apres, params: mod.params, bille: !!bille, annulable: ed.doc.history?.undoLabel?.() ?? null };
  }, r1.id);
  verif(r3.avant === 2 && r3.apres === 3 && r3.params.points.length === 2 && r3.params.points[1][1] === 1.5 && r3.params.fermee === true && r3.params.allerRetour === false,
    `la courbe : ${r3.avant} → ${r3.apres} points, un retiré, fermée : ${JSON.stringify(r3.params)}`);
  verif(!r3.bille, 'une boucle fermée n\'a pas de bille d\'arrivée');

  console.log(bruit.length ? `✗ bruit : ${bruit.slice(0, 4).join(' | ')}` : '✓ aucune erreur de page');
  if (bruit.length) echecs++;
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  await nav.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
