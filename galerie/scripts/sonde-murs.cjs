// LA TAILLE ET LA COURBE DES MURS, dans le navigateur (beta.11) :
//   1. redimensionner un espace : la coque, ce qui est contre un mur le suit,
//      le sol garde sa marge, et une seule annulation revient en arrière ;
//   2. la courbe des murs par l'inspecteur : profondeur, ondulations, sens,
//      sommet en vagues, puis un mur réglé à part ;
//   3. la courbe libre en vue de dessus : ancres posées, une ancre et une
//      poignée tirées À LA SOURIS (la jumelle suit en miroir), Échap termine ;
//   4. la poignée de taille d'un mur, tirée à la souris.
//
//   npm run build:auteur && npx http-server dist-auteur -p 8124 -s
//   PORT=8124 node scripts/sonde-murs.cjs
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8124;
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
const attendre = (page, ms) => page.waitForTimeout(ms);
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage({ viewport: { width: 1100, height: 760 }, locale: 'fr-FR' });
  await page.addInitScript(() => { for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = P.getExtension; P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? null : g.call(this, n); }; } });
  const bruit = [];
  page.on('pageerror', (e) => bruit.push(`[pageerror] ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL-|Failed to load resource/.test(m.text())) bruit.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://localhost:${PORT}/index.html?edit`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.querySelector('#enter-btn')?.disabled, null, { timeout: 240000 });
  await page.evaluate(() => { window.confirm = () => true; document.querySelector('#enter-btn').click(); });
  await page.waitForFunction(() => window.__galerie?.editor?.enabled && window.__galerie.rooms?.current && !window.__galerie.rooms.enEntree, null, { timeout: 120000 });
  await attendre(page, 800);
  // la carte « Trois gestes » d'un premier lancement couvrirait le plan

  // 0. un espace à coque, avec un cube contre le mur est
  const r0 = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor;
    const complet = (r) => r.shell && r.shell !== true && (!Array.isArray(r.shell.walls) || r.shell.walls.length === 4);
    if (!complet(app.rooms.current.config)) {
      const autre = ed.doc.rooms.find(complet);
      if (!autre) return { erreur: 'aucun espace à quatre murs' };
      ed.switchRoom(autre.id);
      await new Promise((r) => setTimeout(r, 2500));
    }
    const room = app.rooms.current;
    const sh = room.config.shell;
    ed.addPrimitive('box');
    await new Promise((r) => setTimeout(r, 400));
    const id = ed.selectedArtwork?.config.id ?? room.config.works.at(-1);
    const w = ed.doc.works.find((x) => x.id === id);
    w.position = [sh.width / 2 - 0.6, w.position[1], 0.5];
    ed.doc._rebuildWork?.(id);
    ed.doc.seal();
    ed.select(null);
    return { roomId: room.config.id, sh: { width: sh.width, depth: sh.depth, height: sh.height, walls: sh.walls ?? null, ceiling: !!sh.ceiling }, sol: room.config.floor?.size ?? null, id };
  });
  if (r0.erreur) { console.log(`✗ ${r0.erreur}`); await nav.close(); process.exit(1); }
  console.log(`  espace ${r0.roomId} : ${JSON.stringify(r0.sh)}, sol ${r0.sol}`);

  // 1. redimensionner : la largeur +4 ; le cube suit le mur est ; le sol garde sa marge ; une annulation
  const r1 = await page.evaluate(async ({ roomId, id }) => {
    const app = window.__galerie; const ed = app.editor;
    const room = app.rooms.current;
    const avant = { ...room.config.shell }, solAvant = room.config.floor?.size, posAvant = [...ed.doc.works.find((x) => x.id === id).position];
    ed.doc.seal();
    ed.redimensionnerEspace(roomId, { width: avant.width + 4 });
    ed.doc.seal();
    await new Promise((r) => setTimeout(r, 400));
    const apres = { shell: { ...app.rooms.current.config.shell }, sol: app.rooms.current.config.floor?.size,
      pos: [...ed.doc.works.find((x) => x.id === id).position],
      enScene: app.rooms.current.artworks.find((a) => a.config.id === id)?.group.position.x,
      estX: app.rooms.current.shell?.userData.courbures?.est?.x ?? null,
      murEst: app.rooms.current.group.getObjectByName?.('mur-est')?.position.x ?? null };
    ed.doc.undo();
    await new Promise((r) => setTimeout(r, 400));
    const annule = { width: app.rooms.current.config.shell.width, sol: app.rooms.current.config.floor?.size, pos: [...ed.doc.works.find((x) => x.id === id).position] };
    return { avant: { width: avant.width, sol: solAvant, pos: posAvant }, apres, annule };
  }, r0);
  verif(r1.apres.shell.width === r1.avant.width + 4, `la largeur passe de ${r1.avant.width} à ${r1.apres.shell.width}`);
  verif(Math.abs(r1.apres.pos[0] - (r1.avant.pos[0] + 2)) < 1e-6 && Math.abs(r1.apres.enScene - r1.apres.pos[0]) < 1e-3,
    `le cube contre le mur est le suit de 2 m : x ${r1.avant.pos[0]} → ${r1.apres.pos[0]} (en scène ${r1.apres.enScene?.toFixed(2)})`);
  if (r1.avant.sol) {
    const marge = r1.avant.sol - Math.max(r1.avant.width, r0.sh.depth);
    const attendu = marge > 4.5 ? Math.max(r1.avant.sol, Math.max(r1.avant.width + 4, r0.sh.depth) + 4) : Math.max(r1.avant.width + 4, r0.sh.depth) + Math.max(0, marge);
    verif(Math.abs(r1.apres.sol - attendu) < 1e-6, `le sol : ${r1.avant.sol} → ${r1.apres.sol} (attendu ${attendu})`);
  }
  verif(r1.annule.width === r1.avant.width && r1.annule.sol === r1.avant.sol && r1.annule.pos[0] === r1.avant.pos[0],
    `une seule annulation : largeur ${r1.annule.width}, sol ${r1.annule.sol}, cube x ${r1.annule.pos[0]}`);

  // 2. la courbe des murs par l'inspecteur
  const r2 = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor; const ins = ed.ui.inspector;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    ed.select(null);
    ins.poserNiveau('expert');
    ins.ouvrirOnglet('piece');
    await pause(300);
    const on = document.querySelector('input[data-cm-on]');
    if (!on) return { erreur: 'section Courbe des murs absente' };
    on.click();
    await pause(500);
    const regler = (sel, v, ev = 'input') => { const e = document.querySelector(sel); e.value = String(v); e.dispatchEvent(new Event(ev, { bubbles: true })); if (ev === 'input') e.dispatchEvent(new Event('change', { bubbles: true })); };
    regler('input[type="range"][data-cm="profondeur"]', 1.5);
    await pause(300);
    regler('input[type="range"][data-cm="ondes"]', 3);
    await pause(300);
    const solCreuse = app.rooms.current.config.floor?.size;
    regler('select[data-cm-sens]', 'bombe', 'change');
    await pause(300);
    const solBombe = app.rooms.current.config.floor?.size;
    let couronne = null;
    const cour = document.querySelector('input[data-cm-cour-on]');
    if (cour) {
      cour.click();
      await pause(400);
      regler('input[type="range"][data-cm-cour="hauteur"]', 2);
      await pause(300);
      couronne = app.rooms.current.config.shell.courbe?.couronne ?? null;
    }
    const c = app.rooms.current.config.shell.courbe;
    const courbures = app.rooms.current.shell?.userData.courbures ?? {};
    const nord = courbures.nord?.loi;
    const fleches = nord ? [0.1, 0.5, 0.9].map((t) => { const L = app.rooms.current.config.shell.width; return Number(nord(-L / 2 + t * L, 1).toFixed(2)); }) : null;
    // un mur à part : l'est, plus creusé
    regler('select[data-cm-cible]', 'est', 'change');
    await pause(400);
    regler('select[data-cm-sens]', 'creuse', 'change');
    await pause(300);
    regler('input[type="range"][data-cm="profondeur"]', 3);
    await pause(400);
    const c2 = app.rooms.current.config.shell.courbe;
    const estLoi = app.rooms.current.shell?.userData.courbures?.est?.loi;
    const Lest = app.rooms.current.config.shell.depth;
    return { c, couronne, fleches, solCreuse, solBombe, murs: c2.murs ?? null, espaceGarde: c2.profondeur,
      flecheEst: estLoi ? Number(estLoi(0, 1).toFixed(2)) : null, Lest };
  });
  if (r2.erreur) verif(false, r2.erreur);
  else {
    verif(r2.c.profondeur === 1.5 && r2.c.ondes === 3 && r2.c.sens === 'bombe', `courbe de l'espace écrite : ${JSON.stringify({ profondeur: r2.c.profondeur, ondes: r2.c.ondes, sens: r2.c.sens })}`);
    verif(Array.isArray(r2.fleches) && r2.fleches.some((f) => f < -0.5) && r2.fleches.some((f) => f > 0.5),
      `le mur nord ondule pour de vrai (3 ondes, bombé) : flèches ${JSON.stringify(r2.fleches)}`);
    verif(r2.solCreuse >= r2.solBombe, `le sol couvre le creusé (${r2.solCreuse}) et revient au bombé (${r2.solBombe})`);
    if (!r0.sh.ceiling) verif(r2.couronne?.hauteur === 2, `sommet en vagues : ${JSON.stringify(r2.couronne)}`);
    verif(r2.murs?.est?.profondeur === 3 && r2.murs.est.sens === 'creuse' && r2.espaceGarde === 1.5,
      `le mur est réglé à part (${JSON.stringify(r2.murs?.est)}), l'espace garde 1,5 m`);
    verif(Math.abs(Math.abs(r2.flecheEst) - 3) < 0.05,
      `le mur est se bâtit avec sa propre courbe (3 m, 3 ondes héritées) : flèche au milieu ${r2.flecheEst}`);
  }

  // 3. la courbe libre du mur est, en vue de dessus, à la souris
  // (la carte « Trois gestes » d'un premier lancement couvrirait le plan)
  await page.evaluate(() => document.querySelector('#editor-onboarding [data-ob-close]')?.click());
  const r3a = await page.evaluate(async () => {
    const ed = window.__galerie.editor;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const b = document.querySelector('button[data-cm-libre]');
    if (!b) return { erreur: 'bouton courbe libre absent' };
    b.click();
    await pause(1500);
    const c = window.__galerie.rooms.current.config.shell.courbe;
    return { points: c.murs?.est?.points ?? null, vue: ed.vueDessus.actif, mur: ed.poignees.mur,
      poignees: ed.poignees.groupe?.children.filter((o) => o.userData.poignee).map((o) => o.userData.poignee.type) ?? [] };
  });
  if (r3a.erreur) verif(false, r3a.erreur);
  verif(r3a.points?.length === 3, `la courbe libre part de trois ancres posées sur la courbe : ${JSON.stringify(r3a.points?.map((p) => [p.t, p.d]))}`);
  verif(r3a.vue && r3a.mur === 'est', 'la vue de dessus s\'ouvre sur le mur est');
  const couvertes = await page.evaluate(async () => {
    const app = window.__galerie; const ed = app.editor;
    await new Promise((r) => setTimeout(r, 1500));
    ed.poignees.update();
    const rect = app.renderer.domElement.getBoundingClientRect();
    return ed.poignees.groupe.children.filter((o) => o.userData.poignee && o.userData.poignee.type !== 'taille').map((m) => {
      const v = m.getWorldPosition(new m.position.constructor()).project(app.camera);
      const x = rect.left + (v.x + 1) / 2 * rect.width, y = rect.top + (1 - v.y) / 2 * rect.height;
      const el = document.elementFromPoint(x, y);
      return el === app.renderer.domElement ? null : `${m.userData.poignee.type}${m.userData.poignee.i}@${Math.round(x)},${Math.round(y)}:${el?.id || el?.className || el?.tagName}`;
    }).filter(Boolean);
  });
  verif(couvertes.length === 0, `le plan se resserre sur le mur est, hors du panneau et de la liste : ${couvertes.length} poignée(s) couverte(s) ${couvertes.join(' ')}`);
  const nb = (t) => r3a.poignees.filter((x) => x === t).length;
  verif(nb('ancre') === 3 && nb('avant') === 3 && nb('apres') === 3 && nb('taille') >= 2,
    `poignées en scène : ${nb('ancre')} ancres, ${nb('avant') + nb('apres')} tangentes, ${nb('taille')} de taille`);

  // la caméra posée (l'entrée en vue de dessus glisse sur plusieurs images)
  const posee = () => page.waitForFunction(() => new Promise((ok) => {
    const cam = window.__galerie.camera; const a = cam.position.toArray().join();
    requestAnimationFrame(() => requestAnimationFrame(() => ok(cam.position.toArray().join() === a)));
  }), null, { timeout: 60000, polling: 200 });
  // où est une poignée à l'écran
  const ecran = async (filtre) => { await posee(); return page.evaluate((f) => {
    const app = window.__galerie; const ed = app.editor;
    ed.poignees.update();
    const m = ed.poignees.groupe?.children.find((o) => { const p = o.userData.poignee; return p && Object.entries(f).every(([k, v]) => p[k] === v); });
    if (!m) return null;
    const v = m.getWorldPosition(new m.position.constructor()).project(app.camera);
    const rect = app.renderer.domElement.getBoundingClientRect();
    return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
  }, filtre); };
  const tirer = async (de, vers) => {
    await page.mouse.move(de[0], de[1]);
    await page.mouse.down();
    for (let k = 1; k <= 4; k++) { await page.mouse.move(de[0] + (vers[0] - de[0]) * k / 4, de[1] + (vers[1] - de[1]) * k / 4); await attendre(page, 30); }
    await page.mouse.up();
    await attendre(page, 400);
  };
  const lire = () => page.evaluate(() => {
    const ed = window.__galerie.editor;
    return { points: window.__galerie.rooms.current.config.shell.courbe?.murs?.est?.points ?? null, ancre: ed.poignees.ancre, sel: ed.selection?.length ?? ed.sel?.size ?? null,
      orbit: window.__galerie.controls?.orbit?.enabled };
  });

  // le mur est : son « dehors » est +x ; tirer l'ancre du milieu vers la droite de l'écran l'écarte
  const a1 = await ecran({ type: 'ancre', i: 1 });
  const p0 = await lire();
  const centre = await page.evaluate(() => { const app = window.__galerie; const v = app.rooms.current.group.getWorldPosition(new app.camera.position.constructor()).project(app.camera); const r = app.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  const versDehors = a1[0] > centre[0] ? 1 : -1;
  await tirer(a1, [a1[0] + versDehors * 60, a1[1]]);
  const p1 = await lire();
  verif(p1.points[1].d > p0.points[1].d + 0.3 && Math.abs(p1.points[1].t - p0.points[1].t) < 0.05,
    `l'ancre du milieu, tirée vers le dehors : d ${p0.points[1].d.toFixed(2)} → ${p1.points[1].d.toFixed(2)}, t ${p0.points[1].t.toFixed(2)} → ${p1.points[1].t.toFixed(2)}`);
  verif(p1.ancre === 1 && p1.orbit !== false, `l'ancre est choisie (${p1.ancre}), l'orbite rendue après le geste`);

  const h = await ecran({ type: 'apres', i: 1 });
  await tirer(h, [h[0] + versDehors * 40, h[1] - 30]);
  const p2 = await lire();
  const av = p2.points[1].avant, ap = p2.points[1].apres;
  const croix = av[0] * ap[1] - av[1] * ap[0], scal = av[0] * ap[0] + av[1] * ap[1];
  verif(Math.abs(croix) < 2e-3 * Math.hypot(...av) * Math.hypot(...ap) + 1e-3 && scal < 0 && (ap[1] !== p1.points[1].apres[1]),
    `la poignée tirée tourne la tangente, sa jumelle suit en miroir : avant ${JSON.stringify(av.map((v) => +v.toFixed(3)))}, après ${JSON.stringify(ap.map((v) => +v.toFixed(3)))}`);

  // Alt : la tangente se casse
  const h2 = await ecran({ type: 'apres', i: 1 });
  await page.keyboard.down('Alt');
  await tirer(h2, [h2[0], h2[1] + 50]);
  await page.keyboard.up('Alt');
  const p3 = await lire();
  verif(JSON.stringify(p3.points[1].avant) === JSON.stringify(p2.points[1].avant) && JSON.stringify(p3.points[1].apres) !== JSON.stringify(p2.points[1].apres),
    'avec Alt, la jumelle reste en place (tangente cassée)');

  // Suppr retire l'ancre choisie ; une annulation la rend
  await page.keyboard.press('Delete');
  await attendre(page, 400);
  const p4 = await lire();
  verif(p4.points?.length === 2, `Suppr retire l'ancre choisie : ${p4.points?.length} ancres`);
  await page.evaluate(() => window.__galerie.editor.doc.undo());
  await attendre(page, 400);
  const p5 = await lire();
  verif(p5.points?.length === 3, `annuler la rend : ${p5.points?.length} ancres`);

  // Échap termine la courbe libre (la vue de dessus reste)
  await page.keyboard.press('Escape');
  await attendre(page, 300);
  const fin = await page.evaluate(() => ({ mur: window.__galerie.editor.poignees.mur, vue: window.__galerie.editor.vueDessus.actif,
    poignees: window.__galerie.editor.poignees.groupe?.children.filter((o) => o.userData.poignee?.type === 'ancre').length ?? 0 }));
  verif(fin.mur === null && fin.poignees === 0, `Échap termine la courbe libre (vue de dessus ${fin.vue ? 'gardée' : 'quittée'})`);

  // 4. la poignée de taille du mur est, à la souris
  const largeur0 = await page.evaluate(() => window.__galerie.rooms.current.config.shell.width);
  if (!fin.vue) await page.evaluate(() => window.__galerie.editor.vueDessus.entrer());
  await attendre(page, 600);
  const t1 = await ecran({ type: 'taille', mur: 'est' });
  const centre2 = await page.evaluate(() => { const app = window.__galerie; const v = app.rooms.current.group.getWorldPosition(new app.camera.position.constructor()).project(app.camera); const r = app.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  const dehors = t1[0] > centre2[0] ? 1 : -1;
  await tirer(t1, [t1[0] + dehors * 70, t1[1]]);
  const largeur1 = await page.evaluate(() => window.__galerie.rooms.current.config.shell.width);
  verif(largeur1 > largeur0 && Math.abs(largeur1 * 2 - Math.round(largeur1 * 2)) < 1e-9,
    `la poignée de taille élargit l'espace au demi-mètre : ${largeur0} → ${largeur1}`);
  // un clic sans geste ne bouge rien
  const t2 = await ecran({ type: 'taille', mur: 'est' });
  await page.mouse.click(t2[0], t2[1]);
  await attendre(page, 300);
  const largeur2 = await page.evaluate(() => window.__galerie.rooms.current.config.shell.width);
  verif(largeur2 === largeur1, `un simple clic sur la poignée ne la fait pas sauter (${largeur2})`);
  await page.evaluate(() => window.__galerie.editor.vueDessus.quitter());
  await attendre(page, 300);
  const sortie = await page.evaluate(() => window.__galerie.editor.poignees.groupe === null);
  verif(sortie, 'hors de la vue de dessus, plus aucune poignée');

  console.log(bruit.length ? `✗ bruit : ${bruit.slice(0, 4).join(' | ')}` : '✓ aucune erreur de page');
  if (bruit.length) echecs++;
  console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est passé');
  await nav.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
