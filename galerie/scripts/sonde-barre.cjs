// LA BARRE DE L'ÉDITEUR (beta.11) : trois zones, un seul bouton Créer et sa pastille de mode, l'Échelle grisée sur un
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
  verif(zones.z[0].boutons.join(',') === 'ajouter,fin-mode', `créer : un seul bouton, et la pastille de mode (${zones.z[0].boutons.join(' ')})`);
  verif(zones.z[1].boutons.slice(0, 4).join(',') === 'translate,rotate,scale,snap', `manipuler : ${zones.z[1].boutons.join(' ')}`);
  verif(!zones.exporter && !zones.dupVers && !zones.premiers && zones.photo === null, 'Exporter, Photo, « vers… » et Premiers pas ont quitté la barre');
  verif(zones.ajouter === 'Créer' && zones.mixage === 'Mixage' && /Publier/.test(zones.publier), `texte sur l'essentiel : Créer, Mixage, Publier`);
  verif(zones.largeur <= zones.visible + 1, `la barre tient sans défiler à 1500 px (${zones.largeur} / ${zones.visible})`);

  // 1 bis. le menu Créer, la pastille de mode, Échap ; Dupliquer / Supprimer sans sélection
  const creer = await page.evaluate(async () => {
    const ed = window.__galerie.editor;
    ed.select(null);
    await new Promise((r) => setTimeout(r, 150));
    const grises = ['dup', 'del'].every((a) => document.querySelector(`#editor-bar [data-a="${a}"]`).disabled);
    document.querySelector('[data-a="ajouter"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const items = [...document.querySelectorAll('.ed-menu > [role="menuitem"], .ed-menu [role="menuitem"]')].filter((e) => e.closest('.ed-menu') === document.querySelector('.ed-menu')).map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    const baie = [...document.querySelectorAll('.ed-menu [role="menuitem"]')].find((e) => /Percer une baie/.test(e.textContent));
    baie?.click();
    await new Promise((r) => setTimeout(r, 200));
    const pastille = document.querySelector('[data-a="fin-mode"]');
    const pendant = { mode: ed.mode, visible: !pastille.hidden, texte: pastille.textContent.trim() };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const apres = { mode: ed.mode, cachee: pastille.hidden };
    return { grises, items, pendant, apres };
  });
  verif(creer.grises, 'sans sélection, Dupliquer et Supprimer sont grisés');
  verif(creer.items.some((t) => /Construire en voxels/.test(t)) && creer.items.some((t) => /Percer une baie/.test(t)) && creer.items.length <= 16, `menu Créer (${creer.items.length} entrées) : ${creer.items.slice(0, 8).join(' · ')}…`);
  verif(creer.pendant.mode === 'decoupe' && creer.pendant.visible && /Découpe · Terminer/.test(creer.pendant.texte), `en Découpe, la pastille le dit : « ${creer.pendant.texte} »`);
  verif(creer.apres.mode === 'objects' && creer.apres.cachee, `Échap termine le mode (${creer.apres.mode}), la pastille se range`);

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
  verif(menus.publier.some((t) => /Photo de la vue/.test(t)) && menus.publier.some((t) => /Exporter galerie\.zip/.test(t)) && menus.publier.some((t) => /Comparer/.test(t)) && menus.publier.some((t) => /Récupérer/.test(t)), `Publier ▾ : ${menus.publier.join(' · ')}`);
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

  // 7. l'inspecteur : les onglets tiennent dans le volet ; la liste : un … par ligne seulement au survol ;
  //    le HUD du visiteur rangé en édition, rendu à l'essai
  const epure = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor;
    const art = app.rooms.current.artworks.find((a) => a.config.role !== 'decor');
    ed.select({ type: 'artwork', id: art.config.id }, { seul: true });
    await new Promise((r) => setTimeout(r, 300));
    const volet = document.querySelector('#editor-panel').getBoundingClientRect();
    const inter = document.querySelector('#editor-panel .ins-niveau').getBoundingClientRect();
    const bordureHaute = getComputedStyle(document.querySelector('#editor-panel .ins-onglets button[role="tab"]')).borderTopWidth;
    const lignes = [...document.querySelectorAll('#editor-hierarchy .h-row')];
    const visibles = lignes.filter((r) => getComputedStyle(r.querySelector('.h-menu') ?? r).opacity !== '0' && r.querySelector('.h-menu')).length;
    const hud = ['progress-badge', 'boussole', 'toolbox'].map((id) => document.getElementById(id)).filter(Boolean);
    const cacheEdition = hud.every((e) => getComputedStyle(e).display === 'none');
    const placement = [...document.querySelectorAll('#editor-panel summary')].some((e) => /Placement/.test(e.textContent));
    const animation = [...document.querySelectorAll('#editor-panel label')].some((e) => /animation : chemin/.test(e.textContent));
    ed.testerIci();
    await new Promise((r) => setTimeout(r, 1200));
    const renduEssai = hud.some((e) => getComputedStyle(e).display !== 'none');
    ed.testerIci();
    await new Promise((r) => setTimeout(r, 800));
    return { dedans: inter.right <= volet.right + 0.5, bordure: bordureHaute, lignes: lignes.length, visibles, cacheEdition, renduEssai, placement, animation, hud: hud.length };
  });
  verif(epure.dedans && epure.bordure === '0px', `onglets de l'inspecteur : à plat (bordure haute ${epure.bordure}), l'interrupteur dans le volet (${epure.dedans})`);
  verif(epure.visibles <= 1, `la liste : ${epure.visibles} « … » visible sur ${epure.lignes} lignes (la ligne sélectionnée)`);
  verif(epure.hud > 0 && epure.cacheEdition && epure.renduEssai, `HUD visiteur (${epure.hud} éléments) rangé en édition, rendu à l'essai`);
  verif(epure.placement && epure.animation, '« Placement » et « animation : chemin » dans l’inspecteur');

  // 8. second passage (beta.11) : onglet Galerie, ✎ rangé, ligne discrète, décor replié,
  //    identifiant en Expert, panneau Publier, bandeau d'essai hors de la boîte à outils
  const second = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor; const ins = ed.ui.inspector;
    const r = {};
    ins.poserNiveau('simple');
    ed.select(null);
    ins.ouvrirOnglet('galerie');
    await new Promise((x) => setTimeout(x, 250));
    r.onglets = [...document.querySelectorAll('#editor-panel .ins-onglets [role="tab"]')].map((b) => b.textContent.trim());
    r.galerie = [...document.querySelectorAll('#editor-panel summary')].map((e) => e.textContent.trim());
    const volet = document.querySelector('#editor-panel').getBoundingClientRect();
    r.interDedans = document.querySelector('#editor-panel .ins-niveau').getBoundingClientRect().right <= volet.right + 0.5;
    ins.ouvrirOnglet('piece');
    await new Promise((x) => setTimeout(x, 250));
    r.espace = [...document.querySelectorAll('#editor-panel summary')].map((e) => e.textContent.trim());
    r.idEspaceSimple = document.querySelector('#editor-panel .ins-id')?.textContent.trim();
    r.ranges = document.querySelector('#editor-panel .ins-ranges')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    r.rangesLien = !!document.querySelector('#editor-panel .ins-ranges button.ins-lien');
    r.crayon = getComputedStyle(document.getElementById('edit-toggle')).display;
    // le décor replié, puis déplié au clic
    const salle = document.querySelector('#editor-hierarchy .h-room.current');
    const pli = salle?.querySelector('[data-decor-pli]');
    r.decorAvant = salle ? salle.querySelectorAll('.h-row.decor').length : -1;
    r.pli = pli?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    pli?.click();
    await new Promise((x) => setTimeout(x, 150));
    r.decorApres = document.querySelector('#editor-hierarchy .h-room.current').querySelectorAll('.h-row.decor').length;
    document.querySelector('#editor-hierarchy .h-room.current [data-decor-pli]')?.click();
    // l'identifiant d'une œuvre : en Expert seulement
    const art = app.rooms.current.artworks.find((a) => a.config.role !== 'decor');
    ed.select({ type: 'artwork', id: art.config.id }, { seul: true });
    await new Promise((x) => setTimeout(x, 250));
    r.idSimple = document.querySelector('#editor-panel .ins-id')?.textContent.trim();
    ins.poserNiveau('expert');
    await new Promise((x) => setTimeout(x, 200));
    r.idExpert = document.querySelector('#editor-panel .ins-id')?.textContent.trim();
    r.artId = art.config.id;
    ins.poserNiveau('simple');
    // le panneau Publier
    await ed.ui.sauvegarde.ouvrir();
    await new Promise((x) => setTimeout(x, 300));
    const panneau = ed.ui.sauvegarde.root;
    r.titre = panneau.querySelector('.sv-tete strong')?.textContent;
    r.blocs = [...panneau.querySelectorAll('.sv-bloc h4')].map((h) => h.textContent.trim());
    // un compte prêt (dépôt et jeton fictifs, le temps d'un rendu, rien d'enregistré)
    const sv = ed.ui.sauvegarde; const avant = { depot: sv.config.depot, jeton: sv.jeton };
    sv.config.depot = 'auteur/depot'; sv.jeton = 'ghp_fictif';
    sv.render();
    r.pret = { premier: [...panneau.querySelectorAll('.sv-bloc:not(.sv-verifs) h4')][0]?.textContent.trim(), replie: !!panneau.querySelector('details.sv-replie:not([open])'),
      dedans: [...panneau.querySelectorAll('details.sv-replie .sv-bloc h4')].map((h) => h.textContent.trim()) };
    sv.config.depot = avant.depot; sv.jeton = avant.jeton; sv.render();
    ed.ui.sauvegarde.hide();
    // le bandeau d'essai sous la boîte à outils
    ed.testerIci();
    await new Promise((x) => setTimeout(x, 1300));
    const ban = document.getElementById('ed-essai')?.getBoundingClientRect();
    const tb = document.getElementById('toolbox')?.getBoundingClientRect();
    r.essai = ban && tb ? { recouvre: ban.bottom > tb.top && ban.top < tb.bottom && ban.right > tb.left && ban.left < tb.right, crayon: getComputedStyle(document.getElementById('edit-toggle')).display } : null;
    ed.testerIci();
    await new Promise((x) => setTimeout(x, 800));
    return r;
  });
  verif(second.onglets.join(',') === 'Espace,Œuvre,Mixage,Galerie' && second.interDedans, `quatre onglets, l'interrupteur dans le volet : ${second.onglets.join(' · ')}`);
  verif(second.galerie.some((t) => /Réglages généraux/.test(t)) && second.galerie.some((t) => /Préférences/.test(t)) && !second.espace.some((t) => /Réglages généraux|Préférences/.test(t)),
    `Galerie : ${second.galerie.join(' · ')} ; Espace n'en parle plus`);
  verif(second.rangesLien && /tout voir$/.test(second.ranges ?? ''), `ligne discrète : « ${second.ranges} »`);
  verif(second.crayon === 'none', `le ✎ du visiteur se range en édition (${second.crayon})${second.essai ? `, revient à l'essai (${second.essai.crayon})` : ''}`);
  verif(second.decorAvant === 0 && /Décor\s*\d+/.test(second.pli ?? '') && second.decorApres > 0, `décor replié : « ${second.pli} », ${second.decorApres} lignes au clic`);
  verif(!second.idSimple?.includes(second.artId) && second.idExpert?.includes(second.artId), `identifiant en Expert seulement : « ${second.idSimple} » / « ${second.idExpert} »`);
  verif(second.titre === 'Publier' && second.blocs.length >= 3 && second.blocs.every((h) => !/^\d/.test(h)), `panneau « ${second.titre} » : ${second.blocs.join(' · ')}`);
  verif(second.pret.premier === 'Mettre en ligne' && second.pret.replie && second.pret.dedans.includes('Garder un fichier'), `compte prêt : « ${second.pret.premier} » en tête, replié dessous : ${second.pret.dedans.join(' · ')}`);
  verif(second.essai && !second.essai.recouvre, 'en essai, le bandeau ne couvre plus la boîte à outils du visiteur');

  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/barre.png`, clip: { x: 0, y: 0, width: 1500, height: 70 } });
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/editeur.png` });
  console.log(bruit.length ? `✗ bruit : ${bruit.slice(0, 4).join(' | ')}` : '✓ aucune erreur de page');
  if (bruit.length) echecs++;
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  await nav.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
