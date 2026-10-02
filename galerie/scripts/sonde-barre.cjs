// LA BARRE DE L'ÉDITEUR (beta.11) : trois zones, l'Échelle grisée sur un
// portail (et la touche 3 qui le dit), Publier ▾ qui range l'export, ? ▾
// qui réunit l'aide, la boîte « Média par URL », la ligne d'état qui se
// range seule, et l'interrupteur Simple / Expert de l'inspecteur.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s
//   PORT=8124 node scripts/sonde-barre.cjs
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1500, height: 900 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => { window.confirm = () => true; document.querySelector('#enter-btn').click(); });
  await page.waitForFunction(() => window.__galerie?.editor?.enabled && window.__galerie.rooms?.current && !window.__galerie.rooms.enEntree, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // 1. les trois zones, dans l'ordre, et ce qui a quitté la barre
  const zones = await page.evaluate(() => {
    const bar = document.querySelector('#editor-bar');
    const z = [...bar.querySelectorAll('.ed-zone')].map((e) => ({ zone: e.dataset.zone, boutons: [...e.querySelectorAll('button')].map((b) => b.dataset.a ?? b.dataset.m ?? b.dataset.mode) }));
    const texte = (sel) => bar.querySelector(sel)?.textContent.trim() ?? null;
    return { z, exporter: !!bar.querySelector('[data-a="exporter"]'), dupVers: !!bar.querySelector('[data-a-dup-to]'), premiers: !!bar.querySelector('[data-a="premiers"]'),
      photo: texte('[data-a="photo"]'), ajouter: texte('[data-a="ajouter"]'), mixage: texte('[data-a="ecoute"]'), publier: texte('[data-a="sauvegarde"]'),
      largeur: bar.scrollWidth, visible: bar.clientWidth };
  });
  verif(zones.z.map((x) => x.zone).join(',') === 'creer,manipuler,voir', `trois zones : ${zones.z.map((x) => `${x.zone}(${x.boutons.length})`).join(' · ')}`);
  verif(zones.z[1].boutons.slice(0, 4).join(',') === 'translate,rotate,scale,snap', `manipuler : ${zones.z[1].boutons.join(' ')}`);
  verif(!zones.exporter && !zones.dupVers && !zones.premiers, 'Exporter, « vers… » et Premiers pas ont quitté la barre');
  verif(zones.photo === '' && zones.ajouter === 'Ajouter' && zones.mixage === 'Mixage' && /Publier/.test(zones.publier), `texte sur l'essentiel : Ajouter, Mixage, Publier ; Photo en icône`);
  verif(zones.largeur <= zones.visible + 1, `la barre tient sans défiler à 1500 px (${zones.largeur} / ${zones.visible})`);

  // 2. l'Échelle : active sur une œuvre, grisée sur un portail, la touche 3 le dit
  const echelle = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor;
    const bouton = () => document.querySelector('#editor-bar button[data-m="scale"]');
    const art = app.rooms.current.artworks.find((a) => a.config.role !== 'decor' && !ed.isLocked?.(a.config.id));
    ed.select({ type: 'artwork', id: art.config.id }, { seul: true });
    await new Promise((r) => setTimeout(r, 200));
    const surOeuvre = !bouton().disabled;
    bouton().click();
    await new Promise((r) => setTimeout(r, 100));
    const mode = ed.tc.mode;
    ed.setGizmoMode('translate');
    const room = app.rooms.current;
    if (!(room.config.portals ?? []).length) return { surOeuvre, mode, portail: null };
    ed.select({ type: 'portal', roomId: room.config.id, index: 0 });
    await new Promise((r) => setTimeout(r, 200));
    const grise = bouton().disabled; const titre = bouton().title;
    document.querySelector('#import-status').textContent = '';
    ed.setGizmoMode('scale');
    await new Promise((r) => setTimeout(r, 100));
    return { surOeuvre, mode, portail: { grise, titre, mode: ed.tc.mode, message: document.querySelector('#import-status')?.textContent ?? '' } };
  });
  verif(echelle.surOeuvre && echelle.mode === 'scale', `sur une œuvre, l'Échelle s'active (mode ${echelle.mode})`);
  if (echelle.portail) {
    verif(echelle.portail.grise && /portail ne se redimensionne pas/.test(echelle.portail.titre), `sur un portail, grisée : « ${echelle.portail.titre} »`);
    verif(echelle.portail.mode === 'translate' && /portail ne se redimensionne pas/.test(echelle.portail.message), `la touche 3 sur un portail le dit : « ${echelle.portail.message} »`);
  } else console.log('— pas de portail dans l’espace d’entrée : cas du portail non éprouvé');

  // 3. Publier ▾ et ? ▾
  const menus = await page.evaluate(async () => {
    const lire = () => [...document.querySelectorAll('.ed-menu [role="menuitem"]')].map((e) => e.textContent.trim());
    document.querySelector('[data-a="publier-menu"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const publier = lire();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 100));
    document.querySelector('[data-a="aide-menu"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const aide = lire();
    const mots = [...document.querySelectorAll('.ed-menu [role="menuitem"]')].find((e) => /mots de l/.test(e.textContent));
    mots?.click();
    await new Promise((r) => setTimeout(r, 200));
    const table = [...document.querySelectorAll('.ed-nomenclature th')].map((e) => e.textContent);
    document.querySelector('.ed-dialogue-fond .ed-primaire')?.click();
    await new Promise((r) => setTimeout(r, 100));
    return { publier, aide, table, ouverte: !!document.querySelector('.ed-dialogue-fond') };
  });
  verif(menus.publier.some((t) => /Exporter galerie\.zip/.test(t)) && menus.publier.some((t) => /Comparer/.test(t)) && menus.publier.some((t) => /Récupérer/.test(t)), `Publier ▾ : ${menus.publier.join(' · ')}`);
  verif(menus.aide.length === 3 && /Raccourcis/.test(menus.aide[0]) && /Premiers pas/.test(menus.aide[1]), `? ▾ : ${menus.aide.join(' · ')}`);
  verif(menus.table.join(',') === 'Espace,Œuvre,Source,Son,Image,Décor,Animation' && !menus.ouverte, `les mots de l'écran : ${menus.table.join(', ')}`);

  // 4. Média par URL : une vraie boîte ; vide, elle refuse ; Échap la referme ; la frappe n'atteint pas les raccourcis
  const url = await page.evaluate(async () => {
    const ed = window.__galerie.editor;
    const p = ed.ui.focusUrlField();
    await new Promise((r) => setTimeout(r, 150));
    const fond = document.body.lastElementChild;
    const champ = fond.querySelector('textarea[data-url-field]');
    const boite = !!fond.querySelector('.ed-dialogue') && document.activeElement === champ;
    const avant = ed.tc.mode;
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    const modeApres = ed.tc.mode;
    fond.querySelector('button.ed-primaire').click();
    await new Promise((r) => setTimeout(r, 100));
    const refusVide = document.body.contains(fond) && champ.classList.contains('ed-champ-vide');
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const r = await p;
    return { boite, refusVide, ferme: !document.body.contains(fond), r, frappe: avant === modeApres, ancienTiroir: !!document.querySelector('#editor-import textarea') };
  });
  verif(url.boite && url.refusVide && url.ferme && url.r === null, 'Média par URL : une boîte, le champ a le focus, vide elle refuse, Échap la referme');
  verif(url.frappe && !url.ancienTiroir, 'la frappe dans le champ n’atteint pas les raccourcis ; plus de champ dans la ligne d’état');

  // 5. la ligne d'état se range seule ; sa croix la ferme
  const statut = await page.evaluate(async () => {
    const ui = window.__galerie.editor.ui;
    ui.notify('Essai de message', 'error');
    const ouverte = !ui.importEl.hidden;
    ui.importEl.querySelector('[data-a="close-import"]').click();
    const fermee = ui.importEl.hidden;
    return { ouverte, fermee, boutonsBruts: ui.importEl.querySelectorAll('button').length };
  });
  verif(statut.ouverte && statut.fermee && statut.boutonsBruts === 1, 'la ligne d’état : un message, une croix qui la ferme');

  // 6. l'interrupteur Simple / Expert
  const niveau = await page.evaluate(async () => {
    const ins = window.__galerie.editor.ui.inspector;
    ins.poserNiveau('simple'); ins.refresh?.();
    await new Promise((r) => setTimeout(r, 100));
    const b = () => document.querySelector('#editor-panel .ins-niveau');
    const avant = { role: b().getAttribute('role'), coche: b().getAttribute('aria-checked'), on: b().querySelector('.on')?.textContent };
    b().click();
    await new Promise((r) => setTimeout(r, 150));
    const apres = { coche: b().getAttribute('aria-checked'), on: b().querySelector('.on')?.textContent, niveau: ins.niveau };
    return { avant, apres, tab: b().getAttribute('role') === 'tab' };
  });
  verif(niveau.avant.role === 'switch' && niveau.avant.on === 'Simple' && niveau.apres.on === 'Expert' && niveau.apres.coche === 'true' && niveau.apres.niveau === 'expert',
    `Simple / Expert : un interrupteur (${niveau.avant.on} → ${niveau.apres.on})`);

  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/barre.png`, clip: { x: 0, y: 0, width: 1500, height: 70 } });
  console.log(bruit.length ? `✗ bruit : ${bruit.slice(0, 4).join(' | ')}` : '✓ aucune erreur de page');
  if (bruit.length) echecs++;
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  await nav.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
